import type { MetadataRoute } from "next";
import { APP_NAME } from "@/config/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} · Das Börsenspiel`,
    short_name: APP_NAME,
    description: "Multiplayer-Börsenspiel mit Spielgeld.",
    lang: "de",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0c10",
    theme_color: "#0a0c10",
    categories: ["games", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
