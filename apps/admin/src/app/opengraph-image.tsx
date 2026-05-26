import { ImageResponse } from "next/og";
import { ODYSSEY_ICON_PATH } from "@/components/odyssey-logo-paths";

export const alt = "Odyssey Admin";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0C0E14",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <svg width="420" height="205" viewBox="0 0 846 412" fill="none">
          <path d={ODYSSEY_ICON_PATH} fill="#8fd1cb" />
        </svg>

        <div
          style={{
            marginTop: 40,
            fontSize: 48,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-0.02em",
          }}
        >
          Odyssey
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 24,
            color: "rgba(255, 255, 255, 0.5)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Admin Dashboard
        </div>
      </div>
    ),
    { ...size },
  );
}
