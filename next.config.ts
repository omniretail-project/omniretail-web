import type { NextConfig } from "next";

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
};

export default nextConfig;
