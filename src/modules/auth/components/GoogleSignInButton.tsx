"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/** Script oficial de Google Identity Services. */
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
/** El boton oficial acepta un ancho de 200 a 400 px. */
const MIN_BUTTON_WIDTH = 200;
const MAX_BUTTON_WIDTH = 400;

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

interface GoogleSignInButtonProps {
  clientId: string;
  /**
   * Recibe el ID token (`credential`) de Google. Solo debe pasarse en memoria al backend: nunca se
   * guarda en estado, localStorage ni logs.
   */
  onCredential: (credential: string) => void;
}

/**
 * Boton oficial "Continuar con Google" (Google Identity Services, `renderButton`), respetando su
 * marca. El script de Google solo se carga donde se monta este componente: el login de la tienda en
 * modo api.
 */
export function GoogleSignInButton({ clientId, onCredential }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    const container = containerRef.current;
    const googleId = window.google?.accounts?.id;
    if (!scriptReady || !container || !googleId) return;

    googleId.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) onCredentialRef.current(response.credential);
      },
      ux_mode: "popup",
    });
    const width = Math.max(
      MIN_BUTTON_WIDTH,
      Math.min(MAX_BUTTON_WIDTH, Math.floor(container.getBoundingClientRect().width) || MAX_BUTTON_WIDTH),
    );
    container.replaceChildren();
    googleId.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      locale: "es",
      width,
    });
  }, [clientId, scriptReady]);

  return (
    <>
      <Script onReady={() => setScriptReady(true)} src={GOOGLE_IDENTITY_SCRIPT} strategy="afterInteractive" />
      <div className="flex min-h-[44px] w-full justify-center" ref={containerRef} />
    </>
  );
}
