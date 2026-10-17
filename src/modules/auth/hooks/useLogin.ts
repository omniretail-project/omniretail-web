"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LOGIN_ATTEMPT_RULES } from "@/config/auth-policy";
import type { UserType } from "@/core/enums";
import { type LoginResult, MfaChallengeUnavailableError } from "@/core/repositories/AuthRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useOptionalPublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import type { LoginFormDto } from "@/modules/auth/application/dto/LoginFormDto";
import { resolvePostLoginDestination } from "@/modules/auth/application/services/postLoginNavigation";
import { useCooldown } from "@/shared/hooks/useCooldown";
import {
  hasLoginValidationErrors,
  validateLoginForm,
  type LoginFormValidationErrors,
} from "@/modules/auth/validation/login.validation";

// Numero de intento (dentro de la misma ventana) en el que
// AuthRepository.login() aplica un bloqueo temporal -- se deriva de la
// config real en vez de repetir el numero "5" aca, para que un cambio a
// LOGIN_ATTEMPT_RULES no desincronice este contador del servidor.
// La duracion del bloqueo es escalonada y la decide el servidor: aqui no
// se muestra ningun tiempo.
const LOCKOUT_ATTEMPT_NUMBER =
  LOGIN_ATTEMPT_RULES.find((rule) => rule.triggersLockout)?.attemptNumber ??
  LOGIN_ATTEMPT_RULES[LOGIN_ATTEMPT_RULES.length - 1].attemptNumber;

// expectedUserType lo fija la ruta que renderiza el login (ver LoginFormDto);
// nunca sale del estado del formulario.
/** Espera entre correos con codigo: la misma que aplica el backend. */
const MFA_RESEND_COOLDOWN_SECONDS = 60;

export function useLogin(expectedUserType: UserType) {
  const repositories = useRepositories();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Este es el UNICO formulario de login, compartido por Customer y
  // Employee/Admin. tenantId (del storefront publico) solo alimenta la
  // resolucion Customer dentro de login() -- si el storefront no
  // resuelve (tenantError/tenantId null), el intento de Customer falla
  // genericamente (correcto: su cuenta SI depende de ese tenant), pero
  // el de Employee/Admin sigue funcionando via el fallback
  // tenant-independiente de login() (ver AuthRepository.LoginInput.
  // tenantId). Por eso solo se bloquea el submit mientras esta
  // "loading" -- nunca por "error", eso ataria tambien al empleado.
  const tenant = useOptionalPublicTenant();
  const tenantId = tenant?.tenantId;
  const tenantLoading = tenant?.loading ?? false;
  const tenantError = tenant?.error;
  const tenantSlug = tenant?.tenantSlug;

  const [email, setEmailState] = useState("");
  const [password, setPasswordState] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFormValidationErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // PR13 (MFA, R-A16): cuando login() responde "mfa_required" en vez de
  // crear sesión, el MISMO formulario pasa a un segundo paso (nunca una
  // ruta nueva) pidiendo el código. demoCodeMock viaja ací¡ solo porque
  // este entorno no tiene un canal real de entrega -- mismo criterio de
  // transparencia dummy que el resto del sistema (ver AuthRepository.
  // LoginResult).
  const [pendingChallenge, setPendingChallenge] = useState<{
    challengeId: string;
    method: "totp" | "email";
    /** Solo en mock; en modo api el codigo sale de la app autenticadora. */
    demoCodeMock?: string;
  } | null>(null);
  const [mfaCode, setMfaCodeState] = useState("");

  // Contador de intentos fallidos CONSECUTIVOS visto por este formulario
  // (nunca preguntado al servidor). AuthRepository.login() siempre
  // responde con el mismo error generico exista o no la cuenta, este o
  // no bloqueada (R-A13/R-A14/R-A19) -- este contador NO cambia eso, es
  // una capa de UX puramente cliente que se adelanta a lo que
  // LOGIN_ATTEMPT_RULES ya haria del lado del servidor, usando valores
  // que ya son publicos en este mismo archivo de config. Nunca revela
  // si la cuenta escrita existe de verdad ni si el bloqueo real ocurrio.
  // Al llegar al umbral solo se muestra un aviso generico sin tiempo: el
  // formulario sigue habilitado y el servidor es la autoridad (sigue
  // respondiendo el error generico mientras la cuenta este bloqueada).
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const tooManyAttempts = consecutiveFailures >= LOCKOUT_ATTEMPT_NUMBER;

  // "Reenviar código" (metodo email): deshabilitado 60 s al entrar al paso 2
  // (el login ya envio el codigo) y despues de cada reenvio.
  const {
    remaining: resendCooldownSeconds,
    active: resendCoolingDown,
    start: startResendCooldown,
    reset: resetResendCooldown,
  } = useCooldown(MFA_RESEND_COOLDOWN_SECONDS);

  const clearFormError = useCallback(() => {
    setFormError(undefined);
  }, []);

  const setEmail = useCallback(
    (value: string) => {
      setEmailState(value);
      clearFormError();
      setFieldErrors((current) => {
        if (!current.email) return current;
        return { ...current, email: validateLoginForm({ email: value, password, rememberMe }).email };
      });
    },
    [clearFormError, password, rememberMe],
  );

  const setPassword = useCallback(
    (value: string) => {
      setPasswordState(value);
      clearFormError();
      setFieldErrors((current) => {
        if (!current.password) return current;
        return { ...current, password: validateLoginForm({ email, password: value, rememberMe }).password };
      });
    },
    [clearFormError, email, rememberMe],
  );

  const setMfaCode = useCallback(
    (value: string) => {
      setMfaCodeState(value);
      clearFormError();
    },
    [clearFormError],
  );

  // Compartido por submit() (cuenta sin MFA) y submitMfaChallenge() (tras
  // completar el segundo factor): resolver el User autenticado y navegar
  // al destino correcto. Session.userId -> User.type, nunca se le pide al
  // usuario que declare el tipo de cuenta.
  const finishLogin = useCallback(
    async (repos: RepositoryRegistry, session: { id: string; userId: string }) => {
      const authenticatedUser = await repos.users.getById(session.userId);
      if (!authenticatedUser) {
        // Estado inconsistente: se creo una sesion valida para un userId
        // que ya no resuelve a un User real. Nunca se inventa un User ni
        // se otorga un destino de empleado por defecto -- se revoca la
        // sesion recien creada y se falla igual que cualquier otro error
        // generico de login (R-A13: no revelar la causa).
        await repos.auth.logout(session.id);
        setFormError("No se pudo iniciar sesion.");
        return;
      }
      setConsecutiveFailures(0);
      setPendingChallenge(null);
      setMfaCodeState("");
      const returnUrl = searchParams?.get("returnUrl") || undefined;
      router.replace(resolvePostLoginDestination(authenticatedUser, returnUrl, tenantSlug));
    },
    [router, searchParams, tenantSlug],
  );

  // Compartido por submit() y loginWithGoogle(): con MFA activo el mismo
  // formulario pasa al segundo paso (PR13, R-A16); si no, entra directo.
  const handleLoginResult = useCallback(
    async (result: LoginResult) => {
      if (result.status === "mfa_required") {
        setPendingChallenge({
          challengeId: result.challengeId,
          method: result.method,
          demoCodeMock: result.demoCodeMock,
        });
        setConsecutiveFailures(0);
        if (result.method === "email") startResendCooldown();
        else resetResendCooldown();
        return;
      }
      await finishLogin(repositories, result.session);
    },
    [finishLogin, repositories, resetResendCooldown, startResendCooldown],
  );

  // `credentials` solo lo usa el acceso rapido de la demo publica: pasa por el mismo login normal.
  const submit = useCallback(async (credentials?: { email: string; password: string }) => {
    setFormError(undefined);

    if (tenantLoading) {
      return;
    }

    const dto: LoginFormDto = credentials
      ? { email: credentials.email, password: credentials.password, rememberMe }
      : { email, password, rememberMe };
    if (credentials) {
      setEmailState(credentials.email);
      setPasswordState(credentials.password);
    }
    const errors = validateLoginForm(dto);
    setFieldErrors(errors);

    if (hasLoginValidationErrors(errors)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await repositories.auth.login({
        tenantId: tenantId ?? undefined,
        email: dto.email.trim(),
        passwordMock: dto.password,
        rememberMe: dto.rememberMe,
        expectedUserType,
      });

      await handleLoginResult(result);
    } catch (caughtError) {
      setFormError(
        caughtError instanceof Error ? caughtError.message : "No se pudo iniciar sesion.",
      );
      setConsecutiveFailures((current) => current + 1);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    email,
    expectedUserType,
    handleLoginResult,
    password,
    rememberMe,
    repositories,
    tenantId,
    tenantLoading,
  ]);

  /**
   * "Continuar con Google" (solo login de la tienda, modo api). `credential` es el ID token de
   * Google: solo se pasa en memoria al repositorio; nunca se guarda en estado, storage ni logs. Un
   * fallo aqui no suma al contador de intentos con contraseña.
   */
  const loginWithGoogle = useCallback(
    async (credential: string) => {
      setFormError(undefined);
      if (!tenantSlug) {
        setFormError("No se pudo iniciar sesion.");
        return;
      }
      setIsSubmitting(true);
      try {
        const result = await repositories.auth.loginWithGoogle({
          idToken: credential,
          tenantSlug,
          rememberMe,
        });
        await handleLoginResult(result);
      } catch (caughtError) {
        setFormError(
          caughtError instanceof Error ? caughtError.message : "No se pudo iniciar sesion.",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [handleLoginResult, rememberMe, repositories, tenantSlug],
  );

  const submitMfaChallenge = useCallback(async () => {
    if (!pendingChallenge || !mfaCode.trim()) {
      return;
    }
    setFormError(undefined);
    setIsSubmitting(true);
    try {
      const session = await repositories.auth.verifyMfaChallenge(
        pendingChallenge.challengeId,
        mfaCode.trim(),
      );
      await finishLogin(repositories, session);
    } catch (caughtError) {
      setFormError(
        caughtError instanceof Error ? caughtError.message : "No se pudo verificar el código.",
      );
      // Un challenge muerto (vencido/invalidado/inexistente) no admite
      // reintento con el mismo challengeId -- se vuelve al primer paso.
      // Un código simplemente incorrecto (con intentos restantes) deja el
      // challenge vivo para que el usuario reintente sin repetir su
      // contraseña (doc 4.12 / QA: "challenge sigue vivo").
      if (caughtError instanceof MfaChallengeUnavailableError) {
        setPendingChallenge(null);
      }
      setMfaCodeState("");
    } finally {
      setIsSubmitting(false);
    }
  }, [finishLogin, mfaCode, pendingChallenge, repositories]);

  /**
   * Reenvia el codigo del metodo email. Devuelve true si se envio. Un desafio
   * vencido o reemplazado vuelve al primer paso, igual que en la verificacion.
   */
  const resendMfaCode = useCallback(async () => {
    if (!pendingChallenge || resendCoolingDown) return false;
    setFormError(undefined);
    try {
      const { demoCodeMock } = await repositories.auth.resendMfaChallengeCode(
        pendingChallenge.challengeId,
      );
      if (demoCodeMock) {
        setPendingChallenge((current) => (current ? { ...current, demoCodeMock } : current));
      }
      startResendCooldown();
      return true;
    } catch (caughtError) {
      setFormError(
        caughtError instanceof Error ? caughtError.message : "No se pudo reenviar el código.",
      );
      if (caughtError instanceof MfaChallengeUnavailableError) {
        setPendingChallenge(null);
        setMfaCodeState("");
      }
      return false;
    }
  }, [pendingChallenge, repositories, resendCoolingDown, startResendCooldown]);

  const cancelMfaChallenge = useCallback(() => {
    setPendingChallenge(null);
    setMfaCodeState("");
    setFormError(undefined);
  }, []);

  return {
    email,
    setEmail,
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    fieldErrors,
    formError,
    isSubmitting,
    tenantLoading,
    tenantError,
    tooManyAttempts,
    submit,
    loginWithGoogle,
    pendingChallenge,
    mfaCode,
    setMfaCode,
    submitMfaChallenge,
    resendMfaCode,
    resendCooldownSeconds,
    cancelMfaChallenge,
  };
}
