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

const themeScript = `(function(){try{var t=localStorage.getItem("odyssey-theme")||"dark";var r=t==="system"?window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light":t;document.documentElement.setAttribute("data-theme",r);document.documentElement.style.colorScheme=r;document.body.style.background=r==="dark"?"#0C0E14":"#F5F5F5"}catch(e){}})()`;

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
      <body style={{ background: "#0C0E14" }} suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
