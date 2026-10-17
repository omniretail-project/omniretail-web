import { isPublicDemo } from "@/config/demo-mode";
import { DemoPasswordRecoveryUnavailable } from "@/modules/auth/components/DemoPasswordRecoveryUnavailable";
import { RequestPasswordResetPage } from "@/modules/auth/pages/RequestPasswordResetPage";

export default function RequestPasswordResetRoutePage() {
  if (isPublicDemo()) return <DemoPasswordRecoveryUnavailable />;
  return <RequestPasswordResetPage />;
}
