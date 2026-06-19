import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND.product} — ${BRAND.company}`,
  description: `${BRAND.product} by ${BRAND.company}: AI marketing pipeline for short-form video and copy.`,
  appleWebApp: {
    title: BRAND.product,
  },
};

export const viewport = {
  themeColor: "#1C1917",
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
