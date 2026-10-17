import { ActivateAccountPage } from "@/modules/auth/pages/ActivateAccountPage";

export default async function ActivateAccountRoutePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ActivateAccountPage token={token} />;
}
