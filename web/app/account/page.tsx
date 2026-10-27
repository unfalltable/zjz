import type { Metadata } from "next";
import { CustomerAccount } from "./customer-account";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };
export default function AccountPage() { return <CustomerAccount />; }
