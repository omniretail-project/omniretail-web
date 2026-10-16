import { AccountStatus, UserStatus, UserType } from "@/core/enums";
import type { AuthAccount, User } from "@/core/entities";
import { DEMO_ACCOUNT_PASSWORDS } from "@/config/demo-mode";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { buildDemoActivity } from "@/infrastructure/mock/seeds/demoActivitySeed";
import { demoSeedDatabase } from "@/infrastructure/mock/seeds/demoSeed";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";

/**
 * Capa de la DEMO PUBLICA sobre el seed base (`demoSeed.ts`, que no cambia). Solo se usa cuando
 * `isPublicDemo()` es true (ver `createMockDatabase`) y persiste en su propia llave de storage.
 * Aplica: marca "Ferretería Demo", cuentas `@marjym.demo` con credenciales publicas, ajustes de
 * existencias de Centro y la actividad (ventas, caja, kardex, pedidos, compras) relativa a `reference`.
 */

const BASE_EMAIL_DOMAIN = "@ferrepharma.demo";
const DEMO_EMAIL_DOMAIN = "@marjym.demo";
const DEMO_BRAND = "Ferretería Demo";
const DEMO_LEGAL_NAME = "Ferretería Demo, S.A.";
const DEMO_CONTACT_EMAIL = `ventas${DEMO_EMAIL_DOMAIN}`;
const NOW = "2026-01-01T12:00:00.000Z";

/** Existencias de Centro ajustadas en la demo para que haya productos cerca del minimo, pero no en cero. */
const CENTRO_STOCK_OVERRIDES: Readonly<Record<string, number>> = {
  "prod-screwdriver-set": 14,
  "prod-wall-plugs": 24,
};

const toDemoEmail = (email: string) =>
  email.endsWith(BASE_EMAIL_DOMAIN)
    ? `${email.slice(0, -BASE_EMAIL_DOMAIN.length)}${DEMO_EMAIL_DOMAIN}`
    : email;

function buildPublicDemoAccounts(base: MockDatabase): AuthAccount[] {
  const passwordByUserId: Record<string, string> = {
    "user-admin": DEMO_ACCOUNT_PASSWORDS.admin,
    "user-cashier": DEMO_ACCOUNT_PASSWORDS.cashier,
    "user-warehouse": DEMO_ACCOUNT_PASSWORDS.warehouse,
  };
  const accounts = base.authAccounts.map((account) =>
    passwordByUserId[account.userId]
      ? {
          ...account,
          email: toDemoEmail(account.email),
          passwordHashMock: buildPasswordHashMock(passwordByUserId[account.userId]),
        }
      : account,
  );
  const missing: Array<[id: string, userId: string, email: string, password: string]> = [
    ["auth-cashier", "user-cashier", `cajero${DEMO_EMAIL_DOMAIN}`, DEMO_ACCOUNT_PASSWORDS.cashier],
    [
      "auth-warehouse",
      "user-warehouse",
      `bodega${DEMO_EMAIL_DOMAIN}`,
      DEMO_ACCOUNT_PASSWORDS.warehouse,
    ],
  ];
  missing.forEach(([id, userId, email, password]) => {
    if (accounts.some((account) => account.userId === userId)) return;
    accounts.push({
      id,
      userId,
      email,
      passwordHashMock: buildPasswordHashMock(password),
      status: AccountStatus.active,
      failedLoginAttempts: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  return accounts;
}

function buildPublicDemoUsers(base: MockDatabase): User[] {
  const users = base.users.map((user) => ({ ...user, email: toDemoEmail(user.email) }));
  users.push({
    id: "user-cashier-norte",
    tenantId: "tenant-demo",
    employeeCode: "POS-002",
    name: "Cajero Norte Demo",
    email: `cajero.norte${DEMO_EMAIL_DOMAIN}`,
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-cashier",
    branchId: "branch-norte",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return users;
}

/** Seed base + capa demo. `reference` fija el "ahora" de la actividad (por defecto, la carga). */
export function buildPublicDemoSeedDatabase(reference: Date = new Date()): MockDatabase {
  const base = structuredClone(demoSeedDatabase);
  const layered: MockDatabase = {
    ...base,
    tenants: base.tenants.map((tenant) => ({
      ...tenant,
      name: DEMO_BRAND,
      legalName: DEMO_LEGAL_NAME,
    })),
    ecommerceConfigs: base.ecommerceConfigs.map((config) => ({
      ...config,
      storeName: DEMO_BRAND,
      contactEmail: DEMO_CONTACT_EMAIL,
    })),
    bankAccounts: base.bankAccounts.map((account) => ({ ...account, holderName: DEMO_LEGAL_NAME })),
    users: buildPublicDemoUsers(base),
    authAccounts: buildPublicDemoAccounts(base),
    inventoryBalances: base.inventoryBalances.map((balance) =>
      balance.branchId === "branch-centro" && balance.productId in CENTRO_STOCK_OVERRIDES
        ? { ...balance, quantity: CENTRO_STOCK_OVERRIDES[balance.productId] }
        : balance,
    ),
  };
  return { ...layered, ...buildDemoActivity(layered, reference) };
}
