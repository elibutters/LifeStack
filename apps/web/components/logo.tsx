import { LOGO_BARE_SVG, svgDataUri } from "@/lib/logo";

export function LogoMark({ size = 28 }: { size?: number }) {
  return <img src={svgDataUri(LOGO_BARE_SVG)} width={size} height={Math.round((size * 248) / 304)} alt="" />;
}
