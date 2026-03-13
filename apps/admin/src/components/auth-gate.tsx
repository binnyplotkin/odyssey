"use client";

import { useState, useEffect, type FormEvent } from "react";

const COOKIE_NAME = "odyssey_admin_auth";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    setAuthed(getCookie(COOKIE_NAME) === "1");
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password === "penis") {
      setCookie(COOKIE_NAME, "1", 30);
      setAuthed(true);
    } else {
      setError(true);
      setPassword("");
    }
  }

  // Still checking cookie
  if (authed === null) return null;

  if (authed) return <>{children}</>;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      {/* Background image */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/landing-hero.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "brightness(0.4)",
        }}
      />

      {/* Login card */}
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
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "#fff",
            letterSpacing: "0.05em",
            margin: 0,
          }}
        >
          Odyssey Admin
        </h1>

        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          placeholder="Password"
          autoFocus
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
            Incorrect password
          </p>
        )}

        <button
          type="submit"
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#105A59",
            color: "#fff",
            fontSize: "0.95rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Enter
        </button>
      </form>
    </div>
  );
}
