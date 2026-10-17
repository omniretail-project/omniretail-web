// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INVALID_IMAGE_URL_MESSAGE } from "@/core/media/resolveImageUrlInput";
import { ImageUrlField } from "@/modules/administration/components/ImageUrlField";

function renderField(props: Partial<React.ComponentProps<typeof ImageUrlField>> = {}) {
  const onChange = vi.fn();
  const onInvalidChange = vi.fn();
  const view = render(
    <ImageUrlField
      currentUrl=""
      disabled={false}
      id="url"
      onChange={onChange}
      onInvalidChange={onInvalidChange}
      {...props}
    />,
  );
  const input = () => screen.getByLabelText("O use una URL pública") as HTMLInputElement;
  const rerender = (next: Partial<React.ComponentProps<typeof ImageUrlField>>) =>
    view.rerender(
      <ImageUrlField
        currentUrl=""
        disabled={false}
        id="url"
        onChange={onChange}
        onInvalidChange={onInvalidChange}
        {...props}
        {...next}
      />,
    );
  return { onChange, onInvalidChange, input, rerender, unmount: view.unmount };
}

describe("ImageUrlField", () => {
  afterEach(cleanup);

  it("muestra la URL guardada", () => {
    expect(renderField({ currentUrl: "https://cdn.example.com/logo.png" }).input().value).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("entrega la URL valida sin espacios y no marca error", () => {
    const { onChange, onInvalidChange, input } = renderField();

    fireEvent.change(input(), { target: { value: "  https://cdn.example.com/logo.png " } });

    expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/logo.png");
    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("acepta una ruta relativa segura del sitio", () => {
    const { onChange, input } = renderField();

    fireEvent.change(input(), { target: { value: "/media/logo.png" } });

    expect(onChange).toHaveBeenCalledWith("/media/logo.png");
  });

  it("una URL invalida queda como borrador, avisa al formulario y muestra el mensaje real", () => {
    const { onChange, onInvalidChange, input } = renderField();

    fireEvent.change(input(), { target: { value: "htt" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(onInvalidChange).toHaveBeenLastCalledWith(true);
    expect(input().value).toBe("htt");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(INVALID_IMAGE_URL_MESSAGE);
  });

  it("el mensaje menciona tambien las rutas relativas que la validacion si acepta", () => {
    expect(INVALID_IMAGE_URL_MESSAGE).toContain("http://");
    expect(INVALID_IMAGE_URL_MESSAGE).toContain("https://");
    expect(INVALID_IMAGE_URL_MESSAGE).toContain("/");
    expect(INVALID_IMAGE_URL_MESSAGE).toMatch(/ruta/);
  });

  it("al corregir la URL se levanta el aviso", () => {
    const { onInvalidChange, input } = renderField();

    fireEvent.change(input(), { target: { value: "htt" } });
    fireEvent.change(input(), { target: { value: "https://cdn.example.com/a.png" } });

    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("al vaciar el campo quita la imagen y limpia el aviso", () => {
    const { onChange, onInvalidChange, input } = renderField({
      currentUrl: "https://cdn.example.com/logo.png",
    });

    fireEvent.change(input(), { target: { value: "htt" } });
    fireEvent.change(input(), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("");
    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si la imagen se elimina por otra via, descarta el borrador y el error", () => {
    const { onInvalidChange, input, rerender } = renderField({
      currentUrl: "https://cdn.example.com/logo.png",
    });
    fireEvent.change(input(), { target: { value: "htt" } });
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender({ currentUrl: "" });

    expect(input().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
  });

  it("si la imagen se reemplaza por otra URL, muestra la nueva y no el borrador anterior", () => {
    const { input, rerender } = renderField({ currentUrl: "https://cdn.example.com/uno.png" });
    fireEvent.change(input(), { target: { value: "htt" } });

    rerender({ currentUrl: "https://cdn.example.com/dos.png" });

    expect(input().value).toBe("https://cdn.example.com/dos.png");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si cambia la syncKey (p. ej. se elige un archivo) descarta el borrador aunque la URL guardada sea la misma", () => {
    const { onInvalidChange, input, rerender } = renderField({ syncKey: "a" });
    fireEvent.change(input(), { target: { value: "htt" } });
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender({ syncKey: "a|archivo" });

    expect(input().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
  });

  it("al desmontar con un borrador invalido pendiente avisa que ya no hay error", () => {
    const { onInvalidChange, input, unmount } = renderField();
    fireEvent.change(input(), { target: { value: "htt" } });
    expect(onInvalidChange).toHaveBeenLastCalledWith(true);

    unmount();

    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
  });

  it("funciona sin onInvalidChange", () => {
    const { input } = renderField({ onInvalidChange: undefined });

    fireEvent.change(input(), { target: { value: "htt" } });

    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
