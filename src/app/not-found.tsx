import type { Metadata } from "next";
import { Button } from "@/shared/components/Button";

export const metadata: Metadata = {
  title: "Página no encontrada | MARJYM",
};

/** 404 global: misma tarjeta que PageErrorState. "/" sirve a visitantes y a personal. */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <section
        aria-labelledby="not-found-title"
        className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6 text-center shadow-sm"
      >
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">Error 404</p>
        <h1 className="mt-1 break-words text-xl font-semibold text-[var(--color-title)]" id="not-found-title">
          Página no encontrada
        </h1>
        <p className="mt-2 break-words text-sm text-[var(--color-text-muted)]">
          La página que buscas no existe o cambió de dirección.
        </p>
        <Button className="mt-6" href="/">
          Volver al inicio
        </Button>
      </section>
    </main>
  );
}
