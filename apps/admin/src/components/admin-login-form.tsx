"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export function AdminLoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const forbidden = searchParams.get("error") === "forbidden";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    forbidden ? "You do not have admin access" : null
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
        setLoading(false);
      } else {
        window.location.href = callbackUrl;
      }
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.25rem",
        padding: "2.5rem",
        background: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(20px)",
        borderRadius: "1rem",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        minWidth: "320px",
      }}
    >
      <svg width="120" height="28" viewBox="0 0 1253 552" fill="none" style={{ marginBottom: "0.25rem" }}>
        <path d="M546.047 167.264C536.748 173.082 520.508 183.309 512.311 189.963C578.447 158.716 640.463 131.927 712.011 112.485C789.513 91.6036 872.254 73.6171 952.815 78.6919C1009 82.2315 1023.71 106.767 977.448 145.978C918.626 195.839 844.995 233.131 775.316 265.992C668.19 315.561 558.614 359.662 447.015 398.124C423.46 406.475 399.821 414.589 376.104 422.467C365.211 426.068 350.785 431.209 339.929 433.914C349.11 429.416 362.505 424.319 372.352 420.133L436.916 392.495C497.647 366.373 558.05 339.497 618.113 311.872L617.721 310.725C556.842 336.257 495.27 360.113 433.078 382.264C415.881 388.481 398.615 394.504 381.282 400.333C372.764 403.239 357.321 408.775 348.761 410.515C394.029 390.182 437.861 371.218 482.997 349.87L481.608 348.6C401.07 383.238 319.612 415.695 237.322 445.937C211.986 455.356 186.565 464.549 161.065 473.515C151.192 476.989 131.532 484.336 121.938 486.82L123.286 488.059C144.465 481.397 167.846 475.355 189.349 469.152C224.934 458.783 260.348 447.835 295.577 436.313C300.048 434.825 304.612 434.009 309.267 432.425C309.34 432.397 309.4 432.376 309.444 432.365C309.385 432.385 309.326 432.405 309.267 432.425C308.39 432.769 305.612 434.269 304.738 434.651C297.707 437.732 290.538 440.322 283.421 443.207L220.921 467.825C147.612 496.268 73.9668 523.836 0 550.523L1.2155 551.713C7.71857 550.248 17.2349 547.162 23.8157 545.257L68.0639 532.447C107.979 521.114 147.982 510.087 188.066 499.368C229.986 487.995 272.003 476.986 314.115 466.343C364.355 453.897 413.647 442.62 463.908 429.408C488.553 422.968 513.112 416.198 537.577 409.101C550.896 405.241 569.354 399.162 582.411 396.39C510.43 430.934 421.953 457.546 345.135 477.587L345.701 478.839C354.186 477.559 369.467 473.83 378.097 471.876C398.096 467.391 418.04 462.668 437.927 457.709C536.288 433.136 637.356 402.314 730.849 362.759L730.464 361.547C684.216 379.574 637.239 395.684 589.663 409.837C571.722 415.289 544.719 424.029 526.568 427.61C565.454 410.989 605.119 397.217 643.09 378.05C654.433 372.323 674.446 366.695 686.973 362.335C707.151 355.294 727.233 347.964 747.205 340.348C838.071 305.741 929.378 264.953 1013.32 215.832C1036.47 202.285 1332.77 16.0042 1231.67 2.96727C1194.12 -1.87509 1145.87 0.366926 1108 1.66091C929.963 7.74303 768.93 45.978 611.086 129.472C588.954 141.273 567.26 153.879 546.047 167.264Z" fill="#fff" />
      </svg>

      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        placeholder="Email"
        autoFocus
        required
        style={{
          width: "100%",
          padding: "0.75rem 1rem",
          borderRadius: "0.5rem",
          border: error
            ? "1px solid #ef4444"
            : "1px solid rgba(255, 255, 255, 0.2)",
          background: "rgba(0, 0, 0, 0.3)",
          color: "#fff",
          fontSize: "0.95rem",
          outline: "none",
        }}
      />

      <input
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(null);
        }}
        placeholder="Password"
        required
        minLength={8}
        style={{
          width: "100%",
          padding: "0.75rem 1rem",
          borderRadius: "0.5rem",
          border: error
            ? "1px solid #ef4444"
            : "1px solid rgba(255, 255, 255, 0.2)",
          background: "rgba(0, 0, 0, 0.3)",
          color: "#fff",
          fontSize: "0.95rem",
          outline: "none",
        }}
      />

      {error && (
        <p style={{ color: "#ef4444", fontSize: "0.8rem", margin: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: "100%",
          padding: "0.75rem",
          borderRadius: "0.5rem",
          border: "none",
          background: "#105A59",
          color: "#fff",
          fontSize: "0.95rem",
          fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>

    </form>
  );
}
