import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.join(process.cwd(), "src");
const MARKETING_DIR = path.join(SRC_DIR, "modules", "marketing");
const LEGACY_PAGE = path.join(SRC_DIR, "app", "(public)", "(commercial)", "page.tsx");
const NEW_LAYOUT = path.join(SRC_DIR, "app", "(marketing)", "layout.tsx");
const NEW_PAGE = path.join(SRC_DIR, "app", "(marketing)", "page.tsx");
const PRICING_COMPONENT = path.join(MARKETING_DIR, "components", "LandingPricing.tsx");

function exitError(msg: string) {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}

// 1. Assert legacy storefront root removed
if (fs.existsSync(LEGACY_PAGE)) {
  exitError(`Legacy Storefront root still exists at ${LEGACY_PAGE}`);
}
console.log("[PASS] Legacy Storefront root removed");

// 2. Assert marketing root exists
if (!fs.existsSync(NEW_LAYOUT) || !fs.existsSync(NEW_PAGE)) {
  exitError("Marketing layout or page missing");
}
console.log("[PASS] Marketing root exists");

// 3. Pricing uses canonical catalog
if (fs.existsSync(PRICING_COMPONENT)) {
  const content = fs.readFileSync(PRICING_COMPONENT, "utf8");
  if (!content.includes("BASE_MONTHLY_QUETZALES") || !content.includes("SUBSCRIPTION_ADDONS")) {
    exitError("LandingPricing does not import canonical catalog prices");
  }
} else {
  exitError("LandingPricing component missing");
}
console.log("[PASS] Pricing uses canonical catalog");

// 4. No Storefront imports
function checkStorefrontImports(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      checkStorefrontImports(fullPath);
    } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
      const content = fs.readFileSync(fullPath, "utf8");
      if (
        content.includes("modules/storefront") ||
        content.includes("PublicTenantProvider") ||
        content.includes("usePublicTenant") ||
        content.includes("StorefrontCartProvider") ||
        content.includes("StorefrontCheckoutConfirmationProvider")
      ) {
        exitError(`Storefront dependency found in ${fullPath}`);
      }
    }
  }
}
if (fs.existsSync(MARKETING_DIR)) {
  checkStorefrontImports(MARKETING_DIR);
}
console.log("[PASS] Landing isolated from Storefront");

// 5. No demo tenant bootstrap
function checkDemoBootstrap(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      checkDemoBootstrap(fullPath);
    } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
      const content = fs.readFileSync(fullPath, "utf8");
      // we allow "/tienda/ferrepharma-demo" as a link but not as a static provider/bootstrap
      // if it's imported from somewhere or passed to a provider, that's bad.
      if (content.includes("ferrepharma-demo") && !content.includes("/tienda/ferrepharma-demo")) {
        exitError(`Demo tenant hardcoded outside of CTA link in ${fullPath}`);
      }
    }
  }
}
checkDemoBootstrap(MARKETING_DIR);
console.log("[PASS] No demo tenant bootstrap");

// 6. SaaS CTAs
function checkCTAs(dir: string) {
  let hasContratar = false;
  let hasLogin = false;

  function scan(scanDir: string) {
    const files = fs.readdirSync(scanDir);
    for (const file of files) {
      const fullPath = path.join(scanDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scan(fullPath);
      } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (content.includes("/contratar")) hasContratar = true;
        if (content.includes("/iniciar-sesion")) hasLogin = true;
      }
    }
  }
  scan(dir);

  if (!hasContratar || !hasLogin) {
    exitError("Missing SaaS CTAs");
  }
}
checkCTAs(MARKETING_DIR);
console.log("[PASS] SaaS CTAs use canonical routes");

// 7. No obsolete pricing tiers
function checkOldTiers(dir: string) {
  function scan(scanDir: string) {
    const files = fs.readdirSync(scanDir);
    for (const file of files) {
      const fullPath = path.join(scanDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scan(fullPath);
      } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (content.includes("Plan Basic") || content.includes("Plan Pro") || content.includes("Plan Enterprise")) {
          exitError(`Obsolete pricing tier found in ${fullPath}`);
        }
      }
    }
  }
  scan(dir);
}
checkOldTiers(MARKETING_DIR);
console.log("[PASS] No obsolete pricing tiers");

// 8. No fake trial claims
function checkFakeTrial(dir: string) {
  function scan(scanDir: string) {
    const files = fs.readdirSync(scanDir);
    for (const file of files) {
      const fullPath = path.join(scanDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scan(fullPath);
      } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf8");
        const lower = content.toLowerCase();
        if (
          lower.includes("14 días gratis") ||
          lower.includes("prueba gratis") ||
          lower.includes("free trial") ||
          lower.includes("empieza gratis")
        ) {
          exitError(`Fake trial claim found in ${fullPath}`);
        }
      }
    }
  }
  scan(dir);
}
checkFakeTrial(MARKETING_DIR);
console.log("[PASS] No fake trial claims");

// 9. Tenant Storefront remains available
const TENANT_STOREFRONT_DIR = path.join(SRC_DIR, "app", "tienda", "[tenantSlug]");
if (!fs.existsSync(TENANT_STOREFRONT_DIR)) {
  exitError("Tenant storefront route missing");
}
console.log("[PASS] Tenant Storefront remains available");

console.log("\nSAAS LANDING CONTRACTS: PASS");
process.exit(0);
