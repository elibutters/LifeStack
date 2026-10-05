import type { MetadataRoute } from "next";
import { palette } from "@/lib/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Life Stack",
    short_name: "Life Stack",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: palette.bg,
    theme_color: palette.bg,
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [{ name: "Calendar", url: "/calendar" }],
  };
}
