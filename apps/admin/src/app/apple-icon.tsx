import { ImageResponse } from "next/og";
import { ODYSSEY_ICON_PATH } from "@/components/odyssey-logo-paths";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0C0E14",
          borderRadius: 36,
        }}
      >
        <svg width="148" height="72" viewBox="0 0 846 412" fill="none">
          <path d={ODYSSEY_ICON_PATH} fill="#8fd1cb" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
