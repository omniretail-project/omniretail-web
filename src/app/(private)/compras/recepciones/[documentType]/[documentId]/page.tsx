import { ReceivingDocumentPage } from "@/modules/receiving";
import type { ReceivingDocumentDetailType } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";

export default async function ReceivingDocumentRoute({
  params,
}: {
  params: Promise<{ documentType: ReceivingDocumentDetailType; documentId: string }>;
}) {
  const { documentType, documentId } = await params;
  return <ReceivingDocumentPage documentId={documentId} documentType={documentType} />;
}
