import { ImageResponse } from "next/og";
import { logoFaviconSvg, logoIconSvg, svgDataUri } from "./logo";

export function renderIcon(px: number, favicon = false) {
  return new ImageResponse(
    <img src={svgDataUri(favicon ? logoFaviconSvg() : logoIconSvg(false))} width={px} height={px} alt="" />,
    { width: px, height: px },
  );
}
