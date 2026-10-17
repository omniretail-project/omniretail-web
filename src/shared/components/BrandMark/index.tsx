import { cn } from "@/shared/utils/cn";

type BrandMarkProps = {
  className?: string;
  /** "dark" para fondos claros (texto/ícono oscuros); "light" para fondos oscuros como el Sidebar. */
  variant?: "dark" | "light";
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  /** Oculta el wordmark "MARJYM" y deja solo el ícono cuadrado -- útil en espacios muy angostos. */
  iconOnly?: boolean;
  /** "column" apila ícono sobre wordmark, centrado -- pensado para el tamaño "2xl" en espacios angostos donde el wordmark no entra al lado del ícono. */
  layout?: "row" | "column";
};

const sizeConfig = {
  sm: { icon: "h-7 w-7 rounded-lg text-sm", word: "text-sm", gap: "gap-2" },
  md: { icon: "h-9 w-9 rounded-lg text-base", word: "text-lg", gap: "gap-2.5" },
  lg: { icon: "h-11 w-11 rounded-xl text-lg", word: "text-2xl", gap: "gap-3" },
  xl: { icon: "h-16 w-16 rounded-2xl text-3xl", word: "text-4xl", gap: "gap-4" },
  "2xl": { icon: "h-28 w-28 rounded-3xl text-5xl", word: "text-6xl", gap: "gap-5" },
} as const;

/**
 * Marca "MARJYM" (rebrand, antes "OmniRetail"). Puramente presentacional --
 * sin logica de negocio, por eso vive en shared/ -- la consumen paginas de
 * auth (Andy) y el Sidebar compartido por todos los modulos.
 */
export function BrandMark({
  className,
  variant = "dark",
  size = "md",
  iconOnly = false,
  layout = "row",
}: BrandMarkProps) {
  const { icon, word, gap } = sizeConfig[size];
  return (
    <span
      className={cn(
        "inline-flex items-center",
        layout === "column" ? "flex-col" : "flex-row",
        gap,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center font-black text-white shadow-sm",
          "bg-gradient-to-br from-[var(--color-structure)] to-[var(--color-primary)]",
          icon,
        )}
      >
        M
      </span>
      {iconOnly ? (
        <span className="sr-only">MARJYM</span>
      ) : (
        <span
          className={cn(
            "font-black tracking-tight",
            word,
            variant === "light" ? "text-white" : "text-[var(--color-title)]",
          )}
        >
          MARJYM
        </span>
      )}
    </span>
  );
}
