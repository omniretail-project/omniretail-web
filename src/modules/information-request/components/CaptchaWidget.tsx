"use client";

import { useEffect, useRef } from "react";

/** Clave publica configurada por despliegue; sin ella no hay CAPTCHA (nunca se inventa una). */
export function getCaptchaSiteKey(): string {
  return (process.env.NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY ?? "").trim();
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

function turnstile(): TurnstileApi | undefined {
  return (globalThis as { turnstile?: TurnstileApi }).turnstile;
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (turnstile()) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("captcha")), { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * CAPTCHA opcional (Cloudflare Turnstile) configurable con NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY. El
 * token vuelve por `onToken`; vacio cuando caduca o falla. `resetKey` vuelve a montar el widget.
 */
export function CaptchaWidget({
  siteKey,
  resetKey,
  onToken,
}: Readonly<{ siteKey: string; resetKey: number; onToken: (token: string) => void }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  // El callback cambia en cada render del formulario; el widget no debe volver a montarse por eso.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let widgetId: string | undefined;
    let active = true;
    const emit = (token: string) => onTokenRef.current(token);
    emit("");
    loadScript()
      .then(() => {
        const api = turnstile();
        if (!active || !api || !containerRef.current) return;
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: emit,
          "expired-callback": () => emit(""),
          "error-callback": () => emit(""),
        });
      })
      .catch(() => emit(""));
    return () => {
      active = false;
      if (widgetId) turnstile()?.remove(widgetId);
    };
  }, [siteKey, resetKey]);

  return <div ref={containerRef} />;
}
