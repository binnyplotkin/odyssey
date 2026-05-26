import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Odyssey Admin",
    short_name: "Odyssey",
    description: "Administration dashboard for Odyssey simulation engine.",
    start_url: "/",
    display: "standalone",
    background_color: "#0C0E14",
    theme_color: "#0C0E14",
    icons: [
      {
        src: "/odyssey_icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
