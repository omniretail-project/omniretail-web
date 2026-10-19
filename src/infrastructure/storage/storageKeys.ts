import { isPublicDemo } from "@/config/demo-mode";

export const MOCK_DATABASE_STORAGE_KEY = "omniretail.mock.database.v1";
export const MOCK_SESSION_STORAGE_KEY = "omniretail.mock.session.v1";

/**
 * La demo publica usa llaves PROPIAS: nunca lee ni pisa la base mock normal
 * (`omniretail.mock.database.v1`) de quien desarrolla en el mismo origen.
 */
export const PUBLIC_DEMO_DATABASE_STORAGE_KEY = "omniretail.mock.public-demo.database.v1";
export const PUBLIC_DEMO_SESSION_STORAGE_KEY = "omniretail.mock.public-demo.session.v1";

export function getMockDatabaseStorageKey(): string {
  return isPublicDemo() ? PUBLIC_DEMO_DATABASE_STORAGE_KEY : MOCK_DATABASE_STORAGE_KEY;
}

export function getMockSessionStorageKey(): string {
  return isPublicDemo() ? PUBLIC_DEMO_SESSION_STORAGE_KEY : MOCK_SESSION_STORAGE_KEY;
}

/**
 * Ultima actividad del empleado (epoch ms) para el cierre por inactividad entre pestañas. Guarda
 * SOLO esa marca de tiempo: nunca tokens ni datos del usuario.
 */
export const EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY = "omniretail.auth.last-activity.v1";
