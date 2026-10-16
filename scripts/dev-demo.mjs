// Levanta la demo publica (modo mock) y, con "all", tambien la app normal enlazada a ella.
//   npm run dev:demo -> solo demo en :3005
//   npm run dev:all  -> app normal en :3000 (boton "Probar demo" activo) + demo en :3005
// Cada servidor usa su propio distDir: Next bloquea dos `next dev` sobre el mismo `.next`.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const APP_PORT = 3000;
const DEMO_PORT = 3005;

const servers = {
  app: {
    port: APP_PORT,
    env: { NEXT_PUBLIC_DEMO_URL: `http://localhost:${DEMO_PORT}` },
  },
  demo: {
    port: DEMO_PORT,
    env: {
      NEXT_DIST_DIR: ".next-demo",
      NEXT_PUBLIC_API_MODE: "mock",
      NEXT_PUBLIC_PUBLIC_DEMO: "true",
      NEXT_PUBLIC_MARKETING_URL: `http://localhost:${APP_PORT}`,
      // La demo nunca debe alcanzar un backend real, aunque .env.local lo defina.
      OMNIRETAIL_API_URL: "",
    },
  },
};

const mode = process.argv[2] === "all" ? "all" : "demo";
const selected = mode === "all" ? ["app", "demo"] : ["demo"];

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

// Validar antes de arrancar: un puerto ocupado detendria el otro servidor a mitad de camino.
const busyPorts = [];
for (const name of selected) {
  if (!(await isPortFree(servers[name].port))) busyPorts.push(servers[name].port);
}
if (busyPorts.length > 0) {
  console.error(
    `Puerto(s) ocupado(s): ${busyPorts.join(", ")}. Detén el servidor que los usa (otro "npm run dev"?) y vuelve a intentarlo.`,
  );
  process.exit(1);
}

const children = selected.map((name) => {
  const { port, env } = servers[name];
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}] `;
  const forward = (target) => (chunk) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) target.write(`${prefix}${line}\n`);
  };
  child.stdout.on("data", forward(process.stdout));
  child.stderr.on("data", forward(process.stderr));
  child.on("exit", (code) => {
    // Si un servidor cae, se detienen todos para no dejar procesos huerfanos.
    stopAll();
    process.exitCode = code ?? 0;
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // En Windows `kill()` no alcanza al proceso nieto de Next (start-server) y quedaria escuchando el puerto.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
