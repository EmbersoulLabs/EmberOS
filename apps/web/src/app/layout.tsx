import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIGC CEO for Marketing",
  description: "AI marketing pipeline — upload, generate, review, export",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
