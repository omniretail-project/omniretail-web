import { administrationPermissions } from "@/modules/administration/permissions";
import { authPermissions } from "@/modules/auth/permissions";
import { catalogPermissions } from "@/modules/catalog/permissions";
import { customerPermissions } from "@/modules/customer/permissions";
import { inventoryPermissions } from "@/modules/inventory/permissions";
import { logisticsPermissions } from "@/modules/logistics/permissions";
import { posPermissions } from "@/modules/pos/permissions";
import { purchasingPermissions } from "@/modules/purchasing/permissions";
import { receivingPermissions } from "@/modules/receiving/permissions";
import { storefrontPermissions } from "@/modules/storefront/permissions";
import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const permissionsConfig = [
  ...authPermissions,
  ...customerPermissions,
  ...storefrontPermissions,
  ...administrationPermissions,
  ...catalogPermissions,
  ...inventoryPermissions,
  ...purchasingPermissions,
  ...receivingPermissions,
  ...posPermissions,
  ...logisticsPermissions,
] satisfies PermissionDefinition[];
