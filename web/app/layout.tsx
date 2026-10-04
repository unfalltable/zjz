import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIOVA 妙物 — Good finds, fewer borders",
  description: "A multilingual cross-border store for useful, unusual and well-made products from Asia.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
