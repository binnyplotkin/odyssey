"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

type AdminLoginFormProps = {
  variant?: "floating" | "side-panel";
};

export function AdminLoginForm({ variant = "floating" }: AdminLoginFormProps) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const forbidden = searchParams.get("error") === "forbidden";
  const isSidePanel = variant === "side-panel";

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
        gap: "1rem",
        width: isSidePanel ? "100%" : "min(calc(100vw - 32px), 390px)",
        maxWidth: isSidePanel ? 360 : undefined,
        padding: isSidePanel ? 0 : "2rem",
        background: isSidePanel ? "transparent" : "var(--surface-1)",
        backdropFilter: isSidePanel ? undefined : "blur(24px) saturate(1.25)",
        WebkitBackdropFilter: isSidePanel ? undefined : "blur(24px) saturate(1.25)",
        borderRadius: isSidePanel ? 0 : "var(--radius-3xl)",
        border: isSidePanel ? "none" : "1px solid rgba(223, 255, 245, 0.24)",
        boxShadow: isSidePanel
          ? "none"
          : "0 24px 80px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
      }}
    >
      {!isSidePanel && (
        <>
          <span aria-hidden="true" style={{ ...cornerPlusStyle, top: -10, left: -5 }}>
            +
          </span>
          <span aria-hidden="true" style={{ ...cornerPlusStyle, top: -10, right: -5 }}>
            +
          </span>
          <span aria-hidden="true" style={{ ...cornerPlusStyle, bottom: -11, left: -5 }}>
            +
          </span>
          <span aria-hidden="true" style={{ ...cornerPlusStyle, bottom: -11, right: -5 }}>
            +
          </span>
        </>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: isSidePanel ? "1rem" : "0.5rem",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 72,
            height: 40,
            background: "#dffff5",
            mask: "url('/odyssey_icon.svg') center / contain no-repeat",
            WebkitMask: "url('/odyssey_icon.svg') center / contain no-repeat",
            filter: "drop-shadow(0 0 24px rgba(85, 236, 191, 0.28))",
          }}
        />
      </div>

      <label style={fieldLabelStyle}>
        <span style={labelTextStyle}>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder="x@odysseylabs.io"
          autoFocus
          required
          style={{
            ...inputStyle,
            borderColor: error
              ? "var(--status-error, #FCA5A5)"
              : "var(--control-border)",
          }}
        />
      </label>

      <label style={fieldLabelStyle}>
        <span style={labelTextStyle}>Password</span>
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
            ...inputStyle,
            borderColor: error
              ? "var(--status-error, #FCA5A5)"
              : "var(--control-border)",
          }}
        />
      </label>

      {error && (
        <p
          role="alert"
          style={{
            color: "#fca5a5",
            fontSize: "0.78rem",
            margin: "-0.25rem 0 0",
            textAlign: "center",
          }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: "100%",
          minHeight: 48,
          padding: "0.75rem 1rem",
          borderRadius: "var(--radius-button, 12px)",
          border: "1px solid var(--emissive-mint)",
          background: "var(--emissive-mint)",
          color: "var(--accent-on, #0A0F12)",
          fontSize: "var(--font-size-base)",
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.6 : 1,
          boxShadow:
            "0 0 28px color-mix(in srgb, var(--emissive-mint) 16%, transparent)",
        }}
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>

    </form>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.45rem",
};

const labelTextStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "var(--font-size-xs)",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  padding: "0.75rem 0.9rem",
  borderRadius: "var(--radius-button, 12px)",
  border: "1px solid var(--control-border)",
  background: "var(--control-bg)",
  color: "var(--foreground)",
  fontSize: "var(--font-size-base)",
  outline: "none",
  boxShadow: "inset 0 1px 0 color-mix(in srgb, white 3%, transparent)",
};

const cornerPlusStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 2,
  color: "rgba(223, 255, 245, 0.72)",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.82rem",
  fontWeight: 500,
  lineHeight: 1,
  pointerEvents: "none",
};
