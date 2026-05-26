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

const themeScript = `(function(){try{var t=localStorage.getItem("odyssey-theme")||"dark";var r=t==="system"?window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light":t;document.documentElement.setAttribute("data-theme",r);document.documentElement.style.colorScheme=r;document.body.style.backgroundColor=r==="dark"?"#05070A":"#F5F6F4"}catch(e){}})()`;

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}
        style={{ backgroundColor: "#05070A" }}
        suppressHydrationWarning
      >
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
