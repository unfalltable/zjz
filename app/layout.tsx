import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hatchway — Objects with their own gravity",
  description: "Curated design objects, shipped worldwide with transparent cross-border delivery.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
