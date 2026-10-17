import { VerifyEmailPage } from "@/modules/auth/pages/VerifyEmailPage";

export default async function VerifyEmailRoutePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <VerifyEmailPage token={token} />;
}
