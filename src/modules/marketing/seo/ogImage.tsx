import { ImageResponse } from "next/og";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * Imagen para compartir (Open Graph / Twitter) del sitio comercial de MARJYM, 1200x630, PNG.
 * Reproduce la marca existente (`BrandMark`: cuadro azul con la M blanca y el wordmark) sin assets
 * externos ni dependencias. La sirve el Route Handler `src/app/(marketing)/og/route.ts`, que solo
 * delega aqui para que el JSX viva en un `.tsx` y la ruta conserve la convencion `route.ts`.
 */
export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #0e2340 0%, #2f67e7 100%)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex" }}>
          <div
            style={{
              alignItems: "center",
              // Mismo degradado del icono de BrandMark (--color-structure -> --color-primary).
              background: "linear-gradient(135deg, #3e668f 0%, #81a9ee 100%)",
              borderRadius: "36px",
              color: "white",
              display: "flex",
              fontSize: "128px",
              fontWeight: 900,
              height: "176px",
              justifyContent: "center",
              width: "176px",
            }}
          >
            M
          </div>
          <div style={{ display: "flex", fontSize: "144px", fontWeight: 900, marginLeft: "40px" }}>
            MARJYM
          </div>
        </div>
        <div style={{ display: "flex", fontSize: "44px", marginTop: "48px", opacity: 0.9 }}>
          Software de inventario, compras y punto de venta
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}
