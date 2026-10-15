"use client";

import { useState } from "react";
import Image from "@/components/product-image";
import type { StoreLocale, StoreProduct } from "@shared/catalog";
import { variantLabel } from "@shared/variants";

export const productOptionCopy = {
  en: { choose: "Choose options", option: "Select your option", from: "From", stock: "in stock", sold: "Sold out", image: "View image", bagFull: "Your bag can contain up to 20 different products or options. Remove one before adding another.", unavailable: "This option is no longer available. Select another option." },
  zh: { choose: "选择规格", option: "选择商品规格", from: "起", stock: "有货", sold: "缺货", image: "查看图片", bagFull: "每次结算最多 20 款商品或规格，请先移除一款再添加。", unavailable: "所选规格已不可售，请重新选择。" },
  es: { choose: "Elegir opciones", option: "Selecciona tu opción", from: "Desde", stock: "disponible", sold: "Agotado", image: "Ver imagen", bagFull: "La bolsa admite hasta 20 productos u opciones distintos. Quita uno antes de añadir otro.", unavailable: "Esta opción ya no está disponible. Elige otra." },
};

/** Exact sellable combinations, so shoppers cannot select a nonexistent colour/size pair. */
export function ProductVariantSelector({ listing, selectedId, onChange, locale, disabled = false }: {
  listing: StoreProduct; selectedId: string; onChange: (id: string) => void; locale: StoreLocale; disabled?: boolean;
}) {
  const variants = listing.variants?.length ? listing.variants : [listing];
  if (!listing.variants?.length && selectedId === listing.id) return null;
  const copy = productOptionCopy[locale];
  return <label className="product-option-select"><span>{copy.option}</span>
    <select value={selectedId} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      {!variants.some((variant) => variant.id === selectedId) && <option value={selectedId} disabled>{copy.unavailable}</option>}
      {variants.map((variant) => <option key={variant.id} value={variant.id}>
        {variantLabel(variant.variantAttributes) || variant.sku} · ${variant.price.toFixed(2)} USD · {variant.inventory ? copy.stock : copy.sold}
      </option>)}
    </select>
  </label>;
}

export function ProductGallery({ product, locale }: { product: StoreProduct; locale: StoreLocale }) {
  const images = Array.from(new Set([product.image, ...(product.images ?? [])])).slice(0, 8);
  const [selected, setSelected] = useState(0);
  return <div className="product-gallery">
    <div className={`product-page-media store-product-${product.color}`}><Image src={images[selected] ?? product.image} alt={product.name} width={1000} height={1000} priority /></div>
    {images.length > 1 && <div className="product-gallery-thumbnails" aria-label={productOptionCopy[locale].image}>
      {images.map((image, index) => <button type="button" key={image} onClick={() => setSelected(index)} aria-pressed={selected === index}
        aria-label={`${productOptionCopy[locale].image} ${index + 1}`}><Image src={image} alt="" width={96} height={96} /></button>)}
    </div>}
  </div>;
}
