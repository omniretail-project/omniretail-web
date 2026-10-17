import { isPublicDemo } from "@/config/demo-mode";
import { DemoPasswordRecoveryUnavailable } from "@/modules/auth/components/DemoPasswordRecoveryUnavailable";
import { ResetPasswordPage } from "@/modules/auth/pages/ResetPasswordPage";

export default async function TenantResetPasswordRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (isPublicDemo()) return <DemoPasswordRecoveryUnavailable />;
  const { token } = await params;
  return <ResetPasswordPage token={token} />;
}
