export function isBranchScopedResourceAvailable(branchIds: string[], branchId: string) {
  return branchIds.length === 0 || branchIds.includes(branchId);
}
