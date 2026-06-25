import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND.product} — ${BRAND.company}`,
  description: `${BRAND.positioning} by ${BRAND.company}. ${BRAND.tagline}`,
  icons: {
    icon: "/brand/favicon.png",
    apple: "/brand/favicon.png",
  },
  appleWebApp: {
    title: BRAND.product,
  },
};

export const viewport = {
  themeColor: "#0A2540",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
