export function shouldRefreshPublicConfig(
  eventTenantId: string | undefined,
  resolvedTenantId: string | null,
): boolean {
  return !eventTenantId || eventTenantId === resolvedTenantId;
}
