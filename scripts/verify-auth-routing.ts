import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolvePostLoginDestination, isSafeCustomerReturnUrl } from "@/modules/auth/application/services/postLoginNavigation";
import { UserType } from "@/core/enums";

async function runTests() {
  console.log("Running structural auth navigation tests...");

  // A, B, C, D tests
  assert.ok(isSafeCustomerReturnUrl("/tienda/panaderia-la-bendicion/cuenta"), "isSafeCustomerReturnUrl must allow /tienda routes without tenant constraint");

  assert.ok(isSafeCustomerReturnUrl("/tienda/panaderia-la-bendicion/cuenta", "panaderia-la-bendicion"), "must allow matching tenant");
  assert.ok(!isSafeCustomerReturnUrl("/tienda/otro-negocio/cuenta", "panaderia-la-bendicion"), "must DENY cross-tenant returnUrl");
  assert.ok(!isSafeCustomerReturnUrl("https://evil.example.com", "panaderia-la-bendicion"), "must deny external redirect");

  const customerUser = { type: UserType.customer } as unknown as import("@/core/entities").User;
  const adminUser = { type: UserType.employee } as unknown as import("@/core/entities").User;

  assert.equal(resolvePostLoginDestination(customerUser, undefined, "panaderia-la-bendicion"), "/tienda/panaderia-la-bendicion", "Default post-login with tenant resolves to storefront home");
  assert.equal(resolvePostLoginDestination(customerUser, "/tienda/panaderia-la-bendicion/cuenta", "panaderia-la-bendicion"), "/tienda/panaderia-la-bendicion/cuenta", "Safe returnUrl with tenant resolves properly");
  assert.equal(resolvePostLoginDestination(customerUser, "/tienda/otro-negocio/cuenta", "panaderia-la-bendicion"), "/tienda/panaderia-la-bendicion", "Cross-tenant returnUrl falls back to storefront home");

  assert.equal(resolvePostLoginDestination(adminUser), "/inicio", "Admin default is /inicio");

  // Structural File Checks (E, F, G, H, I, J)
  const loginPageContent = fs.readFileSync(path.join(process.cwd(), "src/modules/auth/pages/LoginPage.tsx"), "utf8");
  assert.ok(loginPageContent.includes("useOptionalStorefrontRoutes"), "LoginPage must use optional routes");
  assert.ok(!loginPageContent.includes('href="/registro"'), "LoginPage must not hardcode /registro");

  const registerPageContent = fs.readFileSync(path.join(process.cwd(), "src/modules/auth/pages/RegisterPage.tsx"), "utf8");
  assert.ok(registerPageContent.includes("useOptionalStorefrontRoutes"), "RegisterPage must use optional routes");

  const publicLoginPath = path.join(process.cwd(), "src/app/(public)/(accessible)/iniciar-sesion/page.tsx");
  assert.ok(!fs.existsSync(publicLoginPath), "Global route must be moved out of storefront provider tree");

  const authLoginPath = path.join(process.cwd(), "src/app/(auth)/iniciar-sesion/page.tsx");
  assert.ok(fs.existsSync(authLoginPath), "Global route must exist in (auth)");

  const authLayoutPath = path.join(process.cwd(), "src/app/(auth)/layout.tsx");
  const authLayoutContent = fs.readFileSync(authLayoutPath, "utf8");
  assert.ok(!authLayoutContent.includes("PublicTenantProvider"), "(auth) layout must not import PublicTenantProvider");

  // Customer Account Navigation (K, L)
  const customerAccountShellContent = fs.readFileSync(path.join(process.cwd(), "src/modules/customer/components/CustomerAccountShell.tsx"), "utf8");
  assert.ok(customerAccountShellContent.includes("useOptionalStorefrontRoutes"), "CustomerAccountShell must use optional storefront routes for Sidebar navigation");
  assert.ok(customerAccountShellContent.includes("storefrontRoutes.account()"), "CustomerAccountShell must rewrite /cuenta to storefrontRoutes.account()");

  const pedidosPageContent = fs.readFileSync(path.join(process.cwd(), "src/modules/customer/pages/PedidosPage.tsx"), "utf8");
  assert.ok(pedidosPageContent.includes("useOptionalStorefrontRoutes"), "PedidosPage must use optional storefront routes for nested order links");
  assert.ok(pedidosPageContent.includes("storefrontRoutes.accountOrder(order.id)"), "PedidosPage must rewrite order links to storefrontRoutes.accountOrder()");

  console.log("All Auth Navigation contracts passed.");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
