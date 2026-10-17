/**
 * Forma exacta de la respuesta de `GET /api/v1/auth/me` del backend, que los Route Handlers de
 * `app/api/auth` reenvian tal cual. Nunca incluye el token.
 */
export interface ApiCurrentSession {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    type: string;
    status: string;
    tenantId: string;
    customerId: string | null;
    employeeCode: string | null;
    roleId: string | null;
    branchId: string | null;
    allowedBranchIds: string[];
    createdAt: string;
    updatedAt: string;
  };
  role: {
    id: string;
    name: string;
    permissions: string[];
    branchScope: string;
    status: string;
    tenantId: string;
    description: string | null;
    isSystem: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    legalName: string | null;
    status: string;
    defaultCurrency: string;
    timezone: string;
    createdAt: string;
    updatedAt: string;
  };
  session: {
    id: string;
    expiresAt: string;
    rememberMe: boolean | null;
    activeBranchId: string | null;
    createdAt: string;
    deviceLabel: string | null;
  };
}
