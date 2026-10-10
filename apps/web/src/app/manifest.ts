import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: env.productName,
    short_name: env.productName,
    description: messages.product.tagline,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#07080a",
    theme_color: "#07080a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
