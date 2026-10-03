import { ImageResponse } from "next/og";

// Placeholder mark until the app icon is decided.
export function renderIcon(px: number) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#ededed",
          fontSize: px / 2,
          fontWeight: 700,
        }}
      >
        LS
      </div>
    ),
    { width: px, height: px },
  );
}
