import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Los runners de CI son mas lentos que un equipo local: el timeout por defecto (1s) de waitFor
// hacia fallar pruebas de pagina que solo esperan un render asincrono.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
