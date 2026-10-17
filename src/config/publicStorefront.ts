/**
 * Slug del unico storefront publico que existe hoy en este frontend
 * simulado. En produccion, el backend resolveria esto desde el host de
 * la request (dominio/subdominio del storefront); sin ese endpoint, se
 * mantiene como configuracion de deployment.
 *
 * Vive en config/ (no dentro de modules/storefront/) porque tanto el
 * modulo storefront (PublicTenantProvider, para la UI publica) como la
 * capa de infraestructura de auth (MockAuthRepository.registerCustomer,
 * para resolver el tenant de un registro sin confiar en un id elegido
 * por el caller) necesitan la MISMA fuente de verdad -- infrastructure/
 * core no deben depender de un modulo de feature.
 */
export const publicStorefrontSlug = process.env.NEXT_PUBLIC_STOREFRONT_SLUG ?? "ferrepharma-demo";
