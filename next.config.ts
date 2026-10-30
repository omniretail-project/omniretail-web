import type { NextConfig } from "next";

// Importe relativo: next.config.ts no resuelve el alias `@/`. La logica del noindex vive en un modulo propio.
import { buildNoIndexHeaders } from "./src/config/seoHeaders";

const nextConfig: NextConfig = {
  // Genera .next/standalone con un server.js minimo: la imagen Docker de produccion no necesita node_modules completo.
  output: "standalone",
  // `npm run dev:demo` / `dev:all` usan `.next-demo` para correr junto al servidor normal.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Produccion: sin console.log/warn/info/debug en el bundle (console.error se conserva para
  // diagnostico). En desarrollo no cambia nada.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },
  // Sin source maps del navegador en produccion: el codigo original no queda publicado.
  productionBrowserSourceMaps: false,
  // Sin la cabecera `X-Powered-By: Next.js`: no se anuncia el framework a quien escanea el sitio.
  poweredByHeader: false,
  // Optimizador de next/image solo para medios propios: /api/media (proxy del backend) y estaticos.
  images: {
    formats: ["image/avif", "image/webp"],
    localPatterns: [{ pathname: "/api/media/**" }, { pathname: "/images/**" }],
  },
  // `noindex` por cabecera, solo en el build del sitio comercial oficial (ver arriba).
  async headers() {
    return buildNoIndexHeaders({
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
      publicDemo: process.env.NEXT_PUBLIC_PUBLIC_DEMO,
      apiMode: process.env.NEXT_PUBLIC_API_MODE,
    });
  },
};

export default nextConfig;
