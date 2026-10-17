import type { TenantSubscription } from "@/core/entities";
import { TenantSubscriptionStatus } from "@/core/enums";
import { BASE_MONTHLY_QUETZALES, SUBSCRIPTION_ADDONS, subscriptionTotalQuetzales } from "@/core/subscription/catalog";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

/** Clamped UTC anchor: Jan 31 -> Feb 28 -> Mar 31, without date drift. */
export function getBillingCycle(startedAt: string, now: Date) {
  const start = new Date(startedAt);
  const anchorDay = start.getUTCDate();
  const monthly = (offset: number) => {
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(anchorDay, lastDay));
    return first;
  };
  let offset = Math.max(0, (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth());
  if (monthly(offset) > now) offset = Math.max(0, offset - 1);
  return { cycleStart: monthly(offset).toISOString(), nextRenewalAt: monthly(offset + 1).toISOString() };
}

export async function ensureCurrentSubscriptionInvoice(
  repositories: Pick<RepositoryRegistry, "tenantSubscriptions">,
  subscription: TenantSubscription,
  now = new Date(),
) {
  const cycle = getBillingCycle(subscription.startedAt, now);
  if (subscription.status !== TenantSubscriptionStatus.active) return cycle;
  const addonCodes = subscription.addonCodes ?? [];
  await repositories.tenantSubscriptions.ensureInvoice({
    id: `${subscription.id}:${cycle.cycleStart}`,
    tenantId: subscription.tenantId,
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.nextRenewalAt,
    createdAt: now.toISOString(),
    addonCodes: [...addonCodes],
    baseQuetzales: BASE_MONTHLY_QUETZALES,
    addonLines: SUBSCRIPTION_ADDONS.filter((addon) => addonCodes.includes(addon.code)).map(
      (addon) => ({ code: addon.code, name: addon.name, amountQuetzales: addon.monthlyQuetzales }),
    ),
    totalQuetzales: subscriptionTotalQuetzales(addonCodes),
    status: "simulated",
  });
  return cycle;
}
