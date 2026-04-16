import type { Metadata } from "next";
import { SessionProvider } from "@/components/session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Odyssey Admin",
    template: "%s — Odyssey Admin",
  },
  description: "Administration dashboard for Odyssey simulation engine.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Odyssey Admin",
    description: "Administration dashboard for Odyssey simulation engine.",
    siteName: "Odyssey",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Odyssey Admin",
    description: "Administration dashboard for Odyssey simulation engine.",
  },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" style={{ colorScheme: "dark" }}>
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body style={{ background: "#0C0E14" }}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
