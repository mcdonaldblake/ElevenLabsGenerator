import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ElevenLabs Generator",
    short_name: "Voice Lab",
    description: "Private voice browsing and session-only audio generation.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f0e6",
    theme_color: "#101d32",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
