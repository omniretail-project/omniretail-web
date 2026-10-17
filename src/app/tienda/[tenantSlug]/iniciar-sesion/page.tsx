import { Suspense } from "react";
import { UserType } from "@/core/enums";
import { LoginPage } from "@/modules/auth/pages/LoginPage";
export default function Page() { return <Suspense fallback={null}><LoginPage expectedUserType={UserType.customer} /></Suspense>; }
