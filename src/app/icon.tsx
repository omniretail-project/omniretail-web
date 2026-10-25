import { ImageResponse } from "next/og";

// 96x96 (multiplo de 48): Google exige al menos 48x48 para mostrar el icono junto a los resultados.
export const size = {
  width: 96,
  height: 96,
};

export const contentType = "image/png";

/**
 * Icono de la app: la misma marca que el login (`BrandMark`): cuadro redondeado con el degradado
 * `--color-structure` -> `--color-primary` (src/styles/tokens.css) y la M blanca en peso 900.
 * `src/app/favicon.ico` sigue siendo el archivo convencional para /favicon.ico.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #3e668f 0%, #81a9ee 100%)",
          borderRadius: "22px",
          color: "white",
          display: "flex",
          fontSize: "68px",
          fontWeight: 900,
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        M
      </div>
    ),
    size,
  );
}
