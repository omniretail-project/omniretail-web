"use client";

import { useId, useState, type SVGProps } from "react";
import { Input, type InputProps } from "@/shared/components/Input";
import { cn } from "@/shared/utils/cn";

export type PasswordInputProps = Omit<InputProps, "type">;

function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 20 20" {...props}>
      <path
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 20 20" {...props}>
      <path d="M2.5 2.5l15 15" strokeLinecap="round" />
      <path
        d="M8.28 4.24A8.6 8.6 0 0 1 10 4c5.5 0 8.5 6 8.5 6a14.6 14.6 0 0 1-2.44 3.32M6.2 6.2C3.2 7.86 1.5 10 1.5 10s3 6 8.5 6c1.06 0 2.02-.16 2.87-.44"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.3 8.3a2.5 2.5 0 0 0 3.4 3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Envuelve el `Input` compartido (no lo modifica) agregando un toggle para
 * mostrar/ocultar la contraseña. El boton SI es alcanzable con teclado
 * (regla 5.14: foco visible en todos los controles) — no se le quita del
 * tab order. Si el input esta disabled, el toggle tambien queda disabled
 * (visual y funcionalmente, via el atributo nativo disabled del boton).
 */
export function PasswordInput({ className, id, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="relative">
      <Input
        {...props}
        className={cn("pr-11", className)}
        disabled={disabled}
        id={inputId}
        type={visible ? "text" : "password"}
      />
      <button
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        className={cn(
          "absolute inset-y-0 right-0 flex h-10 w-10 items-center justify-center text-[var(--color-text-muted)] transition hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
          disabled && "cursor-not-allowed opacity-60 hover:text-[var(--color-text-muted)]",
        )}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? (
          <EyeOffIcon className="h-[18px] w-[18px]" />
        ) : (
          <EyeIcon className="h-[18px] w-[18px]" />
        )}
      </button>
    </div>
  );
}
