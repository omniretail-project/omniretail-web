import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaptchaWidget,
  getCaptchaSiteKey,
} from "@/modules/information-request/components/CaptchaWidget";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface RenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}

const turnstileRender = vi.fn<(element: HTMLElement, options: RenderOptions) => string>();
const turnstileRemove = vi.fn<(widgetId: string) => void>();

function installTurnstile() {
  (globalThis as { turnstile?: unknown }).turnstile = {
    render: turnstileRender,
    remove: turnstileRemove,
  };
}

function scripts() {
  return document.querySelectorAll<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
}

function lastOptions(): RenderOptions {
  const calls = turnstileRender.mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  turnstileRender.mockReset();
  turnstileRemove.mockReset();
  let counter = 0;
  turnstileRender.mockImplementation(() => `widget-${(counter += 1)}`);
});

afterEach(() => {
  delete (globalThis as { turnstile?: unknown }).turnstile;
  scripts().forEach((script) => script.remove());
  vi.unstubAllEnvs();
});

describe("getCaptchaSiteKey", () => {
  it("devuelve la clave configurada sin espacios", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY", "  site-key-publica  ");
    expect(getCaptchaSiteKey()).toBe("site-key-publica");
  });

  it("devuelve vacio cuando no hay clave: nunca inventa una", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY", "");
    expect(getCaptchaSiteKey()).toBe("");
  });
});

describe("CaptchaWidget con el script ya cargado", () => {
  beforeEach(installTurnstile);

  it("limpia el token al montar y renderiza el widget con la clave recibida", async () => {
    const onToken = vi.fn();
    const { container } = render(<CaptchaWidget onToken={onToken} resetKey={0} siteKey="clave-1" />);

    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));
    expect(onToken).toHaveBeenCalledWith("");
    expect(turnstileRender.mock.calls[0][0]).toBe(container.firstElementChild);
    expect(lastOptions().sitekey).toBe("clave-1");
    expect(scripts()).toHaveLength(0);
  });

  it("entrega el token resuelto y lo vacia al caducar o fallar", async () => {
    const onToken = vi.fn();
    render(<CaptchaWidget onToken={onToken} resetKey={0} siteKey="clave-1" />);
    await waitFor(() => expect(turnstileRender).toHaveBeenCalled());
    onToken.mockClear();

    lastOptions().callback("token-valido");
    expect(onToken).toHaveBeenLastCalledWith("token-valido");

    lastOptions()["expired-callback"]();
    expect(onToken).toHaveBeenLastCalledWith("");

    lastOptions().callback("token-2");
    lastOptions()["error-callback"]();
    expect(onToken).toHaveBeenLastCalledWith("");
  });

  it("retira el widget al desmontar", async () => {
    const { unmount } = render(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);
    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));

    unmount();

    expect(turnstileRemove).toHaveBeenCalledWith("widget-1");
  });

  it("vuelve a montar el widget solo cuando cambia resetKey", async () => {
    const { rerender } = render(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);
    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));

    rerender(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);
    expect(turnstileRender).toHaveBeenCalledTimes(1);
    expect(turnstileRemove).not.toHaveBeenCalled();

    rerender(<CaptchaWidget onToken={vi.fn()} resetKey={1} siteKey="clave-1" />);
    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(2));
    expect(turnstileRemove).toHaveBeenCalledWith("widget-1");
  });

  it("un callback nuevo no remonta el widget y recibe los tokens siguientes", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<CaptchaWidget onToken={first} resetKey={0} siteKey="clave-1" />);
    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));

    rerender(<CaptchaWidget onToken={second} resetKey={0} siteKey="clave-1" />);
    lastOptions().callback("token-nuevo");

    expect(turnstileRender).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith("token-nuevo");
    expect(first).not.toHaveBeenCalledWith("token-nuevo");
  });
});

describe("CaptchaWidget cargando el script externo", () => {
  it("agrega el script una sola vez y renderiza cuando termina de cargar", async () => {
    render(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(true);
    expect(turnstileRender).not.toHaveBeenCalled();

    installTurnstile();
    scripts()[0].dispatchEvent(new Event("load"));

    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));
  });

  it("reutiliza un script ya presente en la pagina", async () => {
    const existing = document.createElement("script");
    existing.src = SCRIPT_SRC;
    document.head.appendChild(existing);

    render(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);
    expect(scripts()).toHaveLength(1);

    installTurnstile();
    existing.dispatchEvent(new Event("load"));

    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));
  });

  it("si el script falla deja el token vacio y no renderiza el widget", async () => {
    const onToken = vi.fn();
    render(<CaptchaWidget onToken={onToken} resetKey={0} siteKey="clave-1" />);
    onToken.mockClear();

    scripts()[0].dispatchEvent(new Event("error"));

    await waitFor(() => expect(onToken).toHaveBeenCalledWith(""));
    expect(turnstileRender).not.toHaveBeenCalled();
  });

  it("si se desmonta antes de que cargue el script no renderiza ni retira nada", async () => {
    const { unmount } = render(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);
    unmount();

    installTurnstile();
    scripts()[0].dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(turnstileRender).not.toHaveBeenCalled();
    expect(turnstileRemove).not.toHaveBeenCalled();
  });

  it("si el script carga pero la API no existe no renderiza", async () => {
    render(<CaptchaWidget onToken={vi.fn()} resetKey={0} siteKey="clave-1" />);

    scripts()[0].dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(turnstileRender).not.toHaveBeenCalled();
  });
});
