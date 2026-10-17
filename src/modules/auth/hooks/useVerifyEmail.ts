"use client";

import { useEffect, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

type VerifyEmailState = "loading" | "success" | "error";
type Repositories = ReturnType<typeof useRepositories>;

/**
 * Cache a nivel de modulo, fuera del ciclo de vida de React.
 * verifyEmail() es una mutacion de un solo uso (consume el token) y no
 * una consulta idempotente: si el efecto de abajo se ejecuta dos veces
 * para el mismo token -- como hace React StrictMode a proposito en
 * desarrollo (monta, desmonta, vuelve a montar) -- la primera llamada
 * verifica la cuenta con exito, pero la segunda encuentra el token ya
 * usado y falla, aunque la cuenta si quedo activa. Se cachea la promesa
 * por token para que un remonte reutilice el resultado real en vez de
 * invocar el repositorio de nuevo.
 */
const verificationAttempts = new Map<string, Promise<{ tenantSlug?: string }>>();

function verifyOnce(repositories: Repositories, token: string): Promise<{ tenantSlug?: string }> {
  let attempt = verificationAttempts.get(token);
  if (!attempt) {
    attempt = repositories.auth.verifyEmail(token);
    verificationAttempts.set(token, attempt);
  }
  return attempt;
}

export function useVerifyEmail(token: string) {
  const repositories = useRepositories();
  const [state, setState] = useState<VerifyEmailState>("loading");
  const [tenantSlug, setTenantSlug] = useState<string | undefined>();

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const result = await verifyOnce(repositories, token);
        if (active) {
          setState("success");
          setTenantSlug(result.tenantSlug);
        }
      } catch {
        // Token inexistente, ya usado o expirado producen el mismo error
        // generico en verifyEmail() (mismo criterio de no revelar detalle
        // que el resto del modulo) -- la UI no intenta distinguirlos.
        if (active) setState("error");
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [repositories, token]);

  return { state, tenantSlug };
}
