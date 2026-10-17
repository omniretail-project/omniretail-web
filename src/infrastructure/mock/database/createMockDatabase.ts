import { isPublicDemo } from "@/config/demo-mode";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { demoSeedDatabase } from "@/infrastructure/mock/seeds/demoSeed";
import { buildPublicDemoSeedDatabase } from "@/infrastructure/mock/seeds/publicDemoSeed";

export function cloneMockDatabase(database: MockDatabase): MockDatabase {
  return structuredClone(database);
}

/**
 * Seed del modo mock. Fuera de la demo publica es SIEMPRE el seed base (sin cambios); la capa
 * demo (marca, cuentas @marjym.demo, actividad) solo se aplica con `isPublicDemo()`.
 */
export function createMockDatabase(reference: Date = new Date()): MockDatabase {
  return isPublicDemo()
    ? buildPublicDemoSeedDatabase(reference)
    : cloneMockDatabase(demoSeedDatabase);
}
