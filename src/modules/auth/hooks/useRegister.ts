"use client";

import { useCallback, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useOptionalPublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import type { RegisterFormDto } from "@/modules/auth/application/dto/RegisterFormDto";
import {
  hasRegisterValidationErrors,
  validateRegisterForm,
  type RegisterFormValidationErrors,
} from "@/modules/auth/validation/register.validation";

interface RegisterCompleted {
  email: string;
  verificationLink: string | null;
}

export function useRegister() {
  const repositories = useRepositories();
  // Solo para UX: evita un submit (y un round-trip fallido) mientras el
  // storefront publico todavia no resolvio o no esta disponible. El
  // tenant real del registro ya NO se decide aca ni se envia al
  // repositorio -- registerCustomer() lo resuelve el mismo, con la misma
  // fuente de verdad (ver AuthRepository.registerCustomer).
  const tenant = useOptionalPublicTenant();
  const tenantSlug = tenant?.tenantSlug;
  const tenantLoading = tenant?.loading ?? false;
  const tenantError = tenant?.error;

  const [name, setNameState] = useState("");
  const [email, setEmailState] = useState("");
  const [phone, setPhoneState] = useState("");
  const [password, setPasswordState] = useState("");
  const [confirmPassword, setConfirmPasswordState] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RegisterFormValidationErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState<RegisterCompleted | null>(null);

  const updateErrors = useCallback((next: RegisterFormDto, fields: Array<keyof RegisterFormValidationErrors>) => {
    setFieldErrors((current) => {
      const validation = validateRegisterForm(next);
      const nextErrors = { ...current };
      for (const field of fields) {
        if (current[field]) nextErrors[field] = validation[field];
      }
      return nextErrors;
    });
  }, []);

  const setName = useCallback((value: string) => {
    setNameState(value);
    updateErrors({ name: value, email, phone, password, confirmPassword }, ["name"]);
  }, [confirmPassword, email, password, phone, updateErrors]);
  const setEmail = useCallback((value: string) => {
    setEmailState(value);
    updateErrors({ name, email: value, phone, password, confirmPassword }, ["email", "password"]);
  }, [confirmPassword, name, password, phone, updateErrors]);
  const setPhone = useCallback((value: string) => {
    setPhoneState(value);
    updateErrors({ name, email, phone: value, password, confirmPassword }, ["phone"]);
  }, [confirmPassword, email, name, password, updateErrors]);
  const setPassword = useCallback((value: string) => {
    setPasswordState(value);
    updateErrors({ name, email, phone, password: value, confirmPassword }, ["password", "confirmPassword"]);
  }, [confirmPassword, email, name, phone, updateErrors]);
  const setConfirmPassword = useCallback((value: string) => {
    setConfirmPasswordState(value);
    updateErrors({ name, email, phone, password, confirmPassword: value }, ["confirmPassword"]);
  }, [email, name, password, phone, updateErrors]);

  const submit = useCallback(async () => {
    setFormError(undefined);

    if (tenantLoading) {
      return;
    }
    if (tenantError) {
      setFormError("La tienda no estí¡ disponible en este momento. Intenta mí¡s tarde.");
      return;
    }

    const dto: RegisterFormDto = { name, email, phone, password, confirmPassword };
    const errors = validateRegisterForm(dto);
    setFieldErrors(errors);

    if (hasRegisterValidationErrors(errors)) {
      return;
    }

    setIsSubmitting(true);
    try {
      // No se pasa ningun tenantId -- registerCustomer() no acepta uno,
      // resuelve el unico tenant publico el mismo. El token demo viaja
      // en el resultado del propio registro (registration-scoped): no
      // existe un metodo separado que permita pedir el token de
      // cualquier cuenta por id.
      const { user: createdUser, emailVerificationToken } =
        await repositories.auth.registerCustomer({
          tenantSlug: tenantSlug ?? "",
          name: dto.name.trim(),
          email: dto.email.trim(),
          phone: dto.phone.trim() || undefined,
          passwordMock: dto.password,
        });
      setCompleted({
        email: createdUser.email,
        verificationLink: emailVerificationToken
          ? `/verificar-correo/${emailVerificationToken}`
          : null,
      });
    } catch (caughtError) {
      setFormError(
        caughtError instanceof Error ? caughtError.message : "No se pudo completar el registro.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [confirmPassword, email, name, password, phone, repositories, tenantError, tenantLoading, tenantSlug]);

  return {
    name,
    setName,
    email,
    setEmail,
    phone,
    setPhone,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    fieldErrors,
    formError,
    isSubmitting,
    completed,
    tenantLoading,
    tenantError,
    submit,
  };
}
