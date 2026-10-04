import type { Metadata } from "next";
import "../../web/app/globals.css";

export const metadata: Metadata = {
  title: "MIOVA 妙物 · 管理后台",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh"><body>{children}</body></html>;
}
