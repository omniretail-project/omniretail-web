import assert from "node:assert/strict";
import { BusinessPreset, TenantStatus } from "@/core/enums";
import { heroBannerDefaultsConfig } from "@/config/hero-banner-defaults";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

const now = "2026-01-01T00:00:00.000Z";

function buildTenant(id: string, name: string) {
  return {
    id,
    name,
    slug: id,
    status: TenantStatus.active,
    defaultCurrency: "GTQ" as const,
    timezone: "America/Guatemala",
    createdAt: now,
    updatedAt: now,
  };
}

function buildCapabilities(tenantId: string, preset: BusinessPreset) {
  return {
    tenantId,
    preset,
    supportsInventory: true,
    supportsLots: false,
    supportsExpiration: false,
    supportsSerials: false,
    supportsMultipleLocations: false,
    supportsUnitsAndPackaging: false,
    supportsProductAttributes: false,
    supportsKits: false,
    supportsServices: false,
    defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
  };
}

function bareTexts(slides: readonly { title: string; description: string }[]) {
  return slides.map(({ title, description }) => ({ title, description }));
}

async function main() {
  // ESCENARIOS 1, 1b, 3, 4, 5 + idempotencia: un storage "legacy" persistido antes de que
  // heroBanners existiera en el schema (mismo criterio que el test legacy ya existente en
  // verify-storefront-public-config-contracts.ts para ecommerceConfigs).
  const seedStorage = new MemoryStorageAdapter();
  const seedStore = new MockDatabaseStore(seedStorage);
  const legacySnapshot = seedStore.getSnapshot();

  const customSlides = [
    { title: "Promoción exclusiva Tenant configurado", description: "Config personalizada que no debe perderse." },
    { title: "Segunda diapositiva custom", description: "Otro texto distinto al default." },
    { title: "Tercera diapositiva custom", description: "Texto propio configurado por el negocio." },
  ];

  legacySnapshot.tenants.push(
    buildTenant("tenant-legacy-preset", "Ferretería Legacy"),
    buildTenant("tenant-legacy-custom-preset", "Negocio A Medida Legacy"),
    buildTenant("tenant-configured", "Negocio Ya Configurado"),
  );
  legacySnapshot.businessCapabilities.push(
    buildCapabilities("tenant-legacy-preset", BusinessPreset.hardware_store),
    buildCapabilities("tenant-legacy-custom-preset", BusinessPreset.custom),
    buildCapabilities("tenant-configured", BusinessPreset.pharmacy),
  );
  legacySnapshot.heroBanners.push({
    tenantId: "tenant-configured",
    slides: customSlides,
    updatedAt: now,
  });
  const preExistingHeroBannerCount = legacySnapshot.heroBanners.length;
  assert.equal(
    legacySnapshot.tenantSubscriptions.some((subscription) => subscription.tenantId === "tenant-legacy-preset"),
    false,
    "Arrange: el tenant legacy no debe tener TenantSubscription propia todavía",
  );

  // Nota: la key `heroBanners` SÍ existe en este storage (ya trae tenant-demo y
  // tenant-configured) -- lo que falta es la entrada puntual de los 2 tenants legacy, que es el
  // caso más realista (backfill per-tenant, no "toda la key ausente"). El caso de key ausente
  // por completo (localStorage anterior a que el campo existiera) se cubre aparte más abajo.
  const legacyStorage = new MemoryStorageAdapter();
  legacyStorage.set(MOCK_DATABASE_STORAGE_KEY, legacySnapshot);
  const legacyStore = new MockDatabaseStore(legacyStorage);
  const normalized = legacyStore.getSnapshot();

  // ESCENARIO 1 -- tenant legacy con preset conocido recibe el default CANÓNICO de ese rubro
  // (misma fuente que "Usar frases sugeridas" en el admin: src/config/hero-banner-defaults.ts).
  const presetBanner = normalized.heroBanners.find((item) => item.tenantId === "tenant-legacy-preset");
  assert.ok(presetBanner, "1: debe crearse HeroBannerConfig para el tenant legacy");
  assert.equal(presetBanner?.tenantId, "tenant-legacy-preset");
  assert.deepEqual(
    bareTexts(presetBanner?.slides ?? []),
    heroBannerDefaultsConfig[BusinessPreset.hardware_store],
    "1: el default debe ser EXACTAMENTE el canónico de hero-banner-defaults.ts para su preset",
  );

  // ESCENARIO 1b -- sin preset de rubro (custom) no hay copy sugerido que reusar: debe arrancar
  // neutro (mismo criterio que el onboarding real -- "arranca neutro, sin copy de ningún rubro").
  const customPresetBanner = normalized.heroBanners.find(
    (item) => item.tenantId === "tenant-legacy-custom-preset",
  );
  assert.ok(customPresetBanner, "1b: debe crearse HeroBannerConfig también para preset custom");
  assert.equal(customPresetBanner?.slides.length, 3, "1b: debe arrancar con 3 slots vacíos");
  assert.ok(
    customPresetBanner?.slides.every((slide) => slide.title === "" && slide.description === ""),
    "1b: sin preset de rubro no debe inventarse copy -- debe quedar neutro",
  );

  // ESCENARIO 3 -- un HeroBannerConfig ya existente NUNCA se reemplaza por el canónico.
  const configuredBanner = normalized.heroBanners.find((item) => item.tenantId === "tenant-configured");
  assert.deepEqual(
    configuredBanner?.slides,
    customSlides,
    "3: la config personalizada existente no debe ser reemplazada por defaults",
  );

  // ESCENARIO 4 -- aislamiento multi-tenant: solo se agregan los tenants que faltaban.
  assert.equal(
    normalized.heroBanners.length,
    preExistingHeroBannerCount + 2,
    "4: solo deben agregarse los 2 tenants sin HeroBannerConfig, sin tocar los demás",
  );
  assert.ok(
    normalized.heroBanners.some((item) => item.tenantId === "tenant-demo"),
    "4: el tenant demo no debe perder su HeroBannerConfig sembrado",
  );

  // ESCENARIO 5 -- agregar el default no debe crear ni alterar entitlement/subscription.
  assert.equal(
    normalized.tenantSubscriptions.some((subscription) => subscription.tenantId === "tenant-legacy-preset"),
    false,
    "5: el backfill de HeroBannerConfig no debe crear/alterar TenantSubscription",
  );
  assert.deepEqual(
    normalized.tenantSubscriptions.filter((subscription) => subscription.tenantId === "tenant-demo"),
    legacySnapshot.tenantSubscriptions.filter((subscription) => subscription.tenantId === "tenant-demo"),
    "5: las subscriptions existentes no deben modificarse como efecto colateral",
  );

  // ESCENARIO 2 -- idempotencia: releer el storage ya normalizado no debe duplicar ni derivar.
  const reloadedStore = new MockDatabaseStore(legacyStorage);
  const reNormalized = reloadedStore.getSnapshot();
  assert.equal(
    reNormalized.heroBanners.length,
    normalized.heroBanners.length,
    "2: normalizar dos veces no debe duplicar HeroBannerConfig",
  );
  assert.deepEqual(
    bareTexts(
      reNormalized.heroBanners.find((item) => item.tenantId === "tenant-legacy-preset")?.slides ?? [],
    ),
    heroBannerDefaultsConfig[BusinessPreset.hardware_store],
    "2: el contenido debe permanecer estable entre normalizaciones sucesivas",
  );
  assert.deepEqual(
    reNormalized.heroBanners.find((item) => item.tenantId === "tenant-configured")?.slides,
    customSlides,
    "2: la config personalizada sigue intacta tras normalizar dos veces",
  );

  // ESCENARIO ADICIONAL -- localStorage anterior a que `heroBanners` existiera en el schema: la
  // key completa está ausente (no solo la entrada de un tenant puntual).
  const noKeySeedStore = new MockDatabaseStore(new MemoryStorageAdapter());
  const noKeySnapshot: Record<string, unknown> = { ...noKeySeedStore.getSnapshot() };
  delete noKeySnapshot.heroBanners;
  const noKeyStorage = new MemoryStorageAdapter();
  noKeyStorage.set(MOCK_DATABASE_STORAGE_KEY, noKeySnapshot);
  const noKeyStore = new MockDatabaseStore(noKeyStorage);
  const noKeyNormalized = noKeyStore.getSnapshot();
  assert.ok(
    noKeyNormalized.heroBanners.some((item) => item.tenantId === "tenant-demo"),
    "key-ausente: con la key heroBanners completamente ausente, el tenant demo debe seguir recibiendo su banner (fallback al seed)",
  );

  // ESCENARIO ADICIONAL -- dos tenants con el MISMO preset no deben compartir el array/objeto
  // mutable de `heroBannerDefaultsConfig` por referencia (mutar uno en vivo no debe afectar al
  // otro ni corromper la fuente canónica compartida por todo el proceso).
  const referenceStorage = new MemoryStorageAdapter();
  const referenceSeedStore = new MockDatabaseStore(referenceStorage);
  const referenceSnapshot = referenceSeedStore.getSnapshot();
  referenceSnapshot.tenants.push(
    buildTenant("tenant-ref-a", "Ferretería Ref A"),
    buildTenant("tenant-ref-b", "Ferretería Ref B"),
  );
  referenceSnapshot.businessCapabilities.push(
    buildCapabilities("tenant-ref-a", BusinessPreset.hardware_store),
    buildCapabilities("tenant-ref-b", BusinessPreset.hardware_store),
  );
  const referenceStorageInitial = { ...referenceSnapshot };
  delete (referenceStorageInitial as Record<string, unknown>).heroBanners;
  const liveStorage = new MemoryStorageAdapter();
  liveStorage.set(MOCK_DATABASE_STORAGE_KEY, referenceStorageInitial);
  const liveStore = new MockDatabaseStore(liveStorage);

  const originalCanonicalTitle = heroBannerDefaultsConfig[BusinessPreset.hardware_store][0]?.title;
  liveStore.mutate((db) => {
    const bannerA = db.heroBanners.find((item) => item.tenantId === "tenant-ref-a");
    assert.ok(bannerA, "ref: tenant-ref-a debe tener HeroBannerConfig backfilled");
    bannerA!.slides[0]!.title = "MUTADO-EN-VIVO-SOLO-TENANT-A";
  });
  const afterLiveMutation = liveStore.getSnapshot();
  const bannerB = afterLiveMutation.heroBanners.find((item) => item.tenantId === "tenant-ref-b");
  assert.notEqual(
    bannerB?.slides[0]?.title,
    "MUTADO-EN-VIVO-SOLO-TENANT-A",
    "ref: dos tenants con el mismo preset no deben compartir el mismo array/objeto de slide por referencia",
  );
  assert.equal(
    heroBannerDefaultsConfig[BusinessPreset.hardware_store][0]?.title,
    originalCanonicalTitle,
    "ref: mutar el HeroBannerConfig de un tenant no debe corromper la fuente canónica compartida por todo el proceso",
  );

  console.log("Legacy hero banner config backfill harness: PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
