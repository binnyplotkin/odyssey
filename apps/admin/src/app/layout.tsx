import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { SessionProvider } from "@/components/session-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Odyssey Admin",
    template: "%s — Odyssey Admin",
  },
  description: "Realtime orchestration layer for Odyssey simulation systems.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Odyssey Admin",
    description: "Realtime orchestration layer for Odyssey simulation systems.",
    siteName: "Odyssey",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Odyssey Admin",
    description: "Realtime orchestration layer for Odyssey simulation systems.",
  },
};

const themeScript = `(function(){try{var t=localStorage.getItem("odyssey-theme")||"dark";var v="river";localStorage.setItem("odyssey-theme-variant",v);localStorage.removeItem("odyssey-theme-debug-overrides");localStorage.removeItem("odyssey-theme-debug-overlay");localStorage.removeItem("odyssey-theme-debug-position");var r=t==="system"?window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light":t;var d=document.documentElement;d.setAttribute("data-theme",r);d.setAttribute("data-theme-variant",v);d.style.colorScheme=r;document.body.style.backgroundColor="var(--background)"}catch(e){}})()`;

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" data-theme-variant="river" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}
        style={{ backgroundColor: "var(--background)" }}
        suppressHydrationWarning
      >
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
