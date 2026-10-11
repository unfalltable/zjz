import type { Metadata } from "next";
import "./globals.css";
import "./storefront.css";

export const metadata: Metadata = {
  title: "MIOVA 妙物 — Shop home, electronics & everyday essentials",
  description: "Browse home essentials, electronics, bags and accessories at MIOVA. Search products, compare USD prices and save your shopping bag.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
