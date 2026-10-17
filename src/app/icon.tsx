import { ImageResponse } from "next/og";

export const size = {
  width: 32,
  height: 32,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#3e668f",
          borderRadius: "8px",
          color: "white",
          display: "flex",
          fontSize: "22px",
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
