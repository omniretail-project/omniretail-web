import { Suspense } from "react";
import { UserType } from "@/core/enums";
import { LoginPage } from "@/modules/auth/pages/LoginPage";

export default function IniciarSesionPage() {
  return (
    <Suspense fallback={null}>
      <LoginPage expectedUserType={UserType.employee} />
    </Suspense>
  );
}
