"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe2, ShoppingBag } from "lucide-react";
import Image from "@/components/product-image";
import { Button } from "@/components/ui/button";
import { CART_STORAGE_KEY, type StoreLocale, type StoreProduct } from "@shared/catalog";
import { useStoreLocale } from "@/hooks/use-storefront";
import { commerceCopy } from "@/lib/commerce-copy";
import { fetchLiveCatalog, parseShoppingBag, productQuantityLimit, readBrowserValue, reconcileShoppingBag, writeBrowserValue } from "@/lib/storefront";

const labels = {
  en: { add: "Add to bag", added: "Added to bag", sold: "Currently unavailable", limited: "Your bag has the available quantity (up to 10 per item).", about: "About this product", bag: "Review your bag", sku: "Product code" },
  zh: { add: "加入购物袋", added: "已加入购物袋", sold: "暂不可售", limited: "购物袋已达到当前库存或单件 10 件上限。", about: "商品介绍", bag: "核对购物袋", sku: "商品编号" },
  es: { add: "Añadir a la bolsa", added: "Añadido a la bolsa", sold: "No disponible", limited: "La bolsa alcanzó las existencias o el límite de 10 unidades.", about: "Sobre el producto", bag: "Revisar bolsa", sku: "Código del producto" },
};

export function ProductDetail({ product: initialProduct }: { product: StoreProduct }) {
  const router = useRouter();
  const [locale, setLocale] = useStoreLocale();
  const t = commerceCopy(locale), label = labels[locale];
  const [product, setProduct] = useState(initialProduct);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setCart(parseShoppingBag(readBrowserValue(CART_STORAGE_KEY)).bag), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const bagCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const add = async () => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const catalog = await fetchLiveCatalog();
      const current = catalog.find((item) => item.id === product.id);
      if (!current || !current.inventory) { setProduct((value) => ({ ...value, inventory: 0 })); setNotice(label.sold); return; }
      setProduct(current);
      if (current.price !== product.price) { setNotice(t.priceChanged); return; }
      const raw = readBrowserValue(CART_STORAGE_KEY);
      const currentCart = reconcileShoppingBag(raw ? parseShoppingBag(raw).bag : cart, catalog);
      if ((currentCart[product.id] ?? 0) >= productQuantityLimit(current)) { setNotice(label.limited); return; }
      const next = { ...currentCart, [product.id]: (currentCart[product.id] ?? 0) + 1 };
      setCart(next);
      const stored = writeBrowserValue(CART_STORAGE_KEY, JSON.stringify(next));
      setStorageUnavailable(!stored);
      setNotice(stored ? label.added : t.storage);
    } catch { setNotice(t.unavailable); }
    finally { setPending(false); }
  };

  return <main className="site-shell store-shell product-page">
    <header className="store-header product-header"><a className="brand store-brand" href="/" aria-label="MIOVA 妙物"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a><label className="track-language"><Globe2 aria-hidden="true" /><span className="sr-only">{t.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as StoreLocale)} aria-label={t.language}><option value="en">English</option><option value="zh">中文</option><option value="es">Español</option></select></label></header>
    <div className="product-page-content"><a href="/#products" className="checkout-back"><ArrowLeft aria-hidden="true" />{t.backStore}</a><div className="product-page-grid"><div className={`product-page-media store-product-${product.color}`}><Image src={product.image} alt={product.name} width={1000} height={1000} priority /></div><section className="product-page-copy" aria-labelledby="product-title"><p>{product.badge[locale]}</p><h1 id="product-title">{product.name}</h1><p>{product.description[locale]}</p><div className="store-detail-price"><strong>${product.price.toFixed(2)} USD</strong>{product.compareAt !== null && <del>${product.compareAt.toFixed(2)}</del>}</div><p>{label.sku}: {product.sku}</p><p>{t.inventory}: {product.inventory} · {t.limit}</p><div className="product-page-actions"><Button onClick={add} disabled={pending || !product.inventory || (cart[product.id] ?? 0) >= productQuantityLimit(product)}><ShoppingBag aria-hidden="true" />{pending ? t.loading : product.inventory ? label.add : label.sold}</Button><Button variant="outline" onClick={() => router.push("/checkout")} disabled={!bagCount || storageUnavailable}>{label.bag} ({bagCount})</Button></div>{notice && <p className="store-bag-notice" role="status">{notice}</p>}<p className="product-page-draft-note">{t.paused}</p><p>{t.dutyNote}</p></section></div><section className="product-page-description" aria-labelledby="product-description"><h2 id="product-description">{label.about}</h2><p>{product.detail[locale]}</p></section></div>
  </main>;
}
