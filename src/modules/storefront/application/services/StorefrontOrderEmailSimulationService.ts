export class StorefrontOrderEmailSimulationService {
  simulateConfirmation(recipientEmail: string, tenantSlug: string, trackingToken: string): { sent: boolean; trackingUrl: string } {
    return {
      sent: Boolean(recipientEmail.trim()),
      trackingUrl: `/tienda/${encodeURIComponent(tenantSlug)}/pedido/seguimiento/${encodeURIComponent(trackingToken)}`,
    };
  }
}
