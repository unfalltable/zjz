import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { getStorefrontProduct } from "@backend/db/catalog";
import { ProductDetail } from "./product-detail";

export const dynamic = "force-dynamic";

const loadProduct = cache(async (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
  if (!ownerId) throw new Error("product_temporarily_unavailable");
  return getStorefrontProduct(ownerId, id);
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await loadProduct(id);
  if (!product) return { title: "Product not found — MIOVA 妙物", robots: { index: false, follow: true } };
  return {
    title: `${product.name} — MIOVA 妙物`,
    description: product.description.en,
    alternates: { canonical: `/product/${encodeURIComponent(product.id)}` },
    openGraph: { title: `${product.name} — MIOVA 妙物`, description: product.description.en, type: "website" },
    twitter: { card: "summary", title: product.name, description: product.description.en },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await loadProduct(id);
  if (!product) notFound();
  return <ProductDetail product={product} />;
}
