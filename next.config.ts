import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera .next/standalone con un server.js minimo: la imagen Docker de produccion no necesita node_modules completo.
  output: "standalone",
  // `npm run dev:demo` / `dev:all` usan `.next-demo` para correr junto al servidor normal.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
