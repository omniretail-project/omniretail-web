import Link from "next/link";
import { DemoUnavailableNotice } from "@/shared/components/DemoUnavailableNotice";

/** Reemplaza las pantallas de recuperacion de contrasena en la demo publica (no hay correo real). */
export function DemoPasswordRecoveryUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
      <DemoUnavailableNotice
        className="w-full"
        description="La recuperación de contraseña no está habilitada en la demo. Usa los accesos rápidos de la pantalla de inicio de sesión."
      >
        <Link className="font-semibold text-[var(--color-title)] hover:underline" href="/iniciar-sesion">
          Volver a iniciar sesión
        </Link>
      </DemoUnavailableNotice>
    </main>
  );
}
