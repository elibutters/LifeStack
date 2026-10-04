import { ImageResponse } from "next/og";
import { logoIconSvg, svgDataUri } from "./logo";

export function renderIcon(px: number) {
  return new ImageResponse(
    <img src={svgDataUri(logoIconSvg(false))} width={px} height={px} alt="" />,
    { width: px, height: px },
  );
}
