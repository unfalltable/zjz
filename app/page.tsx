"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CreditCard,
  Globe2,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";

type Locale = "en" | "zh" | "es";
type Category = "all" | "home" | "tech" | "wear";

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute: (input: Record<string, unknown>) => Promise<string>;
};

type WebMCPDocument = Document & {
  modelContext?: {
    registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void>;
  };
};

const copy = {
  en: {
    announcement: "NEW HERE? TAKE 10% OFF WITH CODE FIRST10",
    delivery: "Free tracked shipping over $75",
    search: "Search products and categories",
    categoryNav: ["Shop all", "Home & living", "Tech", "Bags & accessories"],
    eyebrow: "CURATED IN ASIA · DELIVERED WORLDWIDE",
    title: "Good finds. Fewer borders.",
    body: "Useful, unusual and well-made products from independent makers and trusted suppliers—priced clearly and shipped to your door.",
    primaryCta: "Shop new arrivals",
    secondaryCta: "See best sellers",
    heroDeal: "This week only",
    heroDealValue: "10% off your first order",
    trust: ["Duties shown before payment", "30-day easy returns", "Secure local checkout"],
    shopBy: "Shop by category",
    shopByBody: "Start with what you need. Stay for what you did not know existed.",
    categoryCards: [
      ["Home & living", "Objects that make a space feel yours", "18 finds"],
      ["Smart tech", "Small upgrades for everyday life", "24 finds"],
      ["Carry & wear", "Light, useful and ready to move", "14 finds"],
    ],
    bestKicker: "Popular right now",
    bestTitle: "Best sellers",
    bestBody: "The products customers keep coming back for.",
    viewAll: "View all products",
    add: "Quick add",
    added: "Added to bag",
    quickView: "Quick view",
    rating: "customer rating",
    noResults: "Nothing matched that search. Try ‘speaker’, ‘bag’ or ‘home’.",
    clearSearch: "Clear search",
    promoKicker: "THE HATCHWAY EDIT",
    promoTitle: "Fresh utility, not more clutter.",
    promoBody: "Every product is selected for usefulness, build quality and a point of view. The assortment can change; the standard does not.",
    promoCta: "Explore the edit",
    shippingTitle: "Cross-border shopping, without the mystery.",
    shippingBody: "See the real cost before you pay and follow one tracking timeline from dispatch to your door.",
    shippingSteps: [
      ["Clear totals", "Delivery and estimated duties are visible before payment."],
      ["Checked before dispatch", "Your order is inspected and securely packed before handoff."],
      ["One tracking link", "Follow every milestone, even when logistics partners change."],
    ],
    review: "It feels like a great concept store, but checkout and delivery are as straightforward as a big marketplace.",
    reviewer: "Maya R. · London",
    cart: "Your bag",
    cartDesc: "Delivery and estimated duties are calculated before payment.",
    checkout: "Continue to checkout",
    subtotal: "Subtotal",
    empty: "Your bag is empty.",
    productNote: "In stock · dispatches in 2–4 days",
    services: ["Buyer protection", "Secure payments", "Quality checked", "Worldwide tracking"],
    footer: "Interesting goods from Asia, made easy to buy anywhere.",
    merchant: "Merchant console",
  },
  zh: {
    announcement: "新客输入 FIRST10，首单立减 10%",
    delivery: "满 $75 全球包邮并全程追踪",
    search: "搜索商品与品类",
    categoryNav: ["全部商品", "家居生活", "数码科技", "箱包配饰"],
    eyebrow: "亚洲精选 · 全球送达",
    title: "发现好物，跨境不难。",
    body: "从独立设计者和可信供应商中精选实用、有趣、品质在线的商品，价格清楚，直接送到你家。",
    primaryCta: "逛逛新品",
    secondaryCta: "查看热卖",
    heroDeal: "本周限定",
    heroDealValue: "首单立减 10%",
    trust: ["付款前显示税费", "30 天轻松退换", "本地化安全支付"],
    shopBy: "按品类逛",
    shopByBody: "从你需要的开始，也可能发现从未想到的好东西。",
    categoryCards: [
      ["家居生活", "让空间更像你的实用好物", "18 件商品"],
      ["智能科技", "给日常加一点聪明升级", "24 件商品"],
      ["箱包穿戴", "轻巧、实用，随时出发", "14 件商品"],
    ],
    bestKicker: "当下人气",
    bestTitle: "畅销好物",
    bestBody: "这些是顾客会再次回来购买的商品。",
    viewAll: "查看全部商品",
    add: "快速加入",
    added: "已加入购物袋",
    quickView: "快速查看",
    rating: "顾客评分",
    noResults: "没有匹配的商品，可以试试“音响”“包”或“家居”。",
    clearSearch: "清除搜索",
    promoKicker: "HATCHWAY 本周精选",
    promoTitle: "真正有用，不制造杂物。",
    promoBody: "每件商品都经过实用性、品质与设计感筛选。商品可以更换，但选品标准不会。",
    promoCta: "探索本周精选",
    shippingTitle: "跨境购物，不再一头雾水。",
    shippingBody: "付款前看清真实成本，从发货到送达，全程只需一个追踪链接。",
    shippingSteps: [
      ["总价透明", "付款前显示运费与预估税费。"],
      ["发货前检查", "交接物流前完成质检与安全包装。"],
      ["一个链接追踪", "即使更换物流商，也能查看每个节点。"],
    ],
    review: "像逛一家很会选品的概念店，但下单和配送又像大平台一样简单。",
    reviewer: "Maya R. · 伦敦",
    cart: "购物袋",
    cartDesc: "运费与预估税费将在付款前计算。",
    checkout: "继续结账",
    subtotal: "小计",
    empty: "购物袋还是空的。",
    productNote: "现货 · 2–4 天内发出",
    services: ["买家保障", "安全支付", "发货前质检", "全球物流追踪"],
    footer: "亚洲有趣好物，让世界各地都能轻松购买。",
    merchant: "商家工作台",
  },
  es: {
    announcement: "10% EN TU PRIMER PEDIDO CON FIRST10",
    delivery: "Envío con seguimiento gratis desde $75",
    search: "Buscar productos y categorías",
    categoryNav: ["Ver todo", "Hogar", "Tecnología", "Bolsos y accesorios"],
    eyebrow: "SELECCIONADO EN ASIA · ENVIADO AL MUNDO",
    title: "Buenos hallazgos. Menos fronteras.",
    body: "Productos útiles, originales y bien hechos de creadores independientes y proveedores de confianza, con precios claros y entrega a domicilio.",
    primaryCta: "Ver novedades",
    secondaryCta: "Más vendidos",
    heroDeal: "Solo esta semana",
    heroDealValue: "10% en tu primer pedido",
    trust: ["Impuestos antes de pagar", "Devoluciones en 30 días", "Pago local seguro"],
    shopBy: "Comprar por categoría",
    shopByBody: "Empieza por lo que necesitas. Quédate por lo inesperado.",
    categoryCards: [
      ["Hogar", "Objetos que hacen tu espacio más tuyo", "18 hallazgos"],
      ["Tecnología", "Pequeñas mejoras para cada día", "24 hallazgos"],
      ["Bolsos y accesorios", "Ligeros, útiles y listos para salir", "14 hallazgos"],
    ],
    bestKicker: "Popular ahora",
    bestTitle: "Más vendidos",
    bestBody: "Los productos que nuestros clientes vuelven a elegir.",
    viewAll: "Ver todos",
    add: "Añadir",
    added: "Añadido a la bolsa",
    quickView: "Vista rápida",
    rating: "valoración de clientes",
    noResults: "No hay resultados. Prueba ‘altavoz’, ‘bolso’ u ‘hogar’.",
    clearSearch: "Borrar búsqueda",
    promoKicker: "LA EDICIÓN HATCHWAY",
    promoTitle: "Utilidad nueva, no más ruido.",
    promoBody: "Elegimos cada producto por su utilidad, calidad y personalidad. El surtido cambia; el estándar no.",
    promoCta: "Explorar la edición",
    shippingTitle: "Compras globales, sin misterio.",
    shippingBody: "Conoce el coste real antes de pagar y sigue todo el trayecto en un solo enlace.",
    shippingSteps: [
      ["Totales claros", "Envío e impuestos estimados antes del pago."],
      ["Control antes de salir", "Revisamos y protegemos tu pedido antes de entregarlo."],
      ["Un solo seguimiento", "Todos los hitos, aunque cambie el operador logístico."],
    ],
    review: "Se siente como una gran tienda de concepto, pero comprar y recibir es tan fácil como en un gran marketplace.",
    reviewer: "Maya R. · Londres",
    cart: "Tu bolsa",
    cartDesc: "Envío e impuestos estimados se calculan antes del pago.",
    checkout: "Continuar al pago",
    subtotal: "Subtotal",
    empty: "Tu bolsa está vacía.",
    productNote: "En stock · sale en 2–4 días",
    services: ["Protección al comprador", "Pagos seguros", "Control de calidad", "Seguimiento mundial"],
    footer: "Productos interesantes de Asia, fáciles de comprar desde cualquier lugar.",
    merchant: "Panel de vendedor",
  },
} as const;

const products = [
  {
    id: "kumo", name: "Cloud Cat Figure", price: 89, compareAt: 109, rating: 4.9, reviews: 128,
    category: "home" as Category, image: "/products/kumo.webp", color: "blue",
    badge: { en: "Limited", zh: "限量", es: "Limitado" },
    description: { en: "Soft-touch art object · NFC passport", zh: "亲肤材质艺术摆件 · NFC 证书", es: "Objeto artístico · pasaporte NFC" },
    detail: { en: "A small-run decorative figure with a soft-touch finish and a scannable authenticity passport.", zh: "小批量制作的艺术摆件，亲肤表面处理，并附带可扫描的真伪证书。", es: "Figura decorativa de serie corta, acabado suave y pasaporte de autenticidad escaneable." },
  },
  {
    id: "nova", name: "Nova Orb Speaker", price: 129, compareAt: null, rating: 4.8, reviews: 94,
    category: "tech" as Category, image: "/products/nova.webp", color: "ice",
    badge: { en: "New", zh: "新品", es: "Nuevo" },
    description: { en: "Spatial audio · 12-hour battery", zh: "空间音效 · 12 小时续航", es: "Audio espacial · 12 horas" },
    detail: { en: "A compact wireless speaker with room-filling sound, tactile controls and up to 12 hours of play.", zh: "小巧无线音响，空间音效、实体按键，最长可播放 12 小时。", es: "Altavoz inalámbrico compacto, controles táctiles y hasta 12 horas de reproducción." },
  },
  {
    id: "loop", name: "Loop Mini Crossbody", price: 64, compareAt: 79, rating: 4.7, reviews: 211,
    category: "wear" as Category, image: "/products/loop.webp", color: "coral",
    badge: { en: "Best seller", zh: "热卖", es: "Más vendido" },
    description: { en: "Recycled nylon · modular strap", zh: "再生尼龙 · 模块化背带", es: "Nailon reciclado · correa modular" },
    detail: { en: "A lightweight everyday crossbody made from recycled nylon with an adjustable modular strap.", zh: "轻量日用斜挎包，使用再生尼龙与可调节模块化背带。", es: "Bandolera ligera de nailon reciclado con correa modular ajustable." },
  },
] as const;

const categoryOrder: Category[] = ["all", "home", "tech", "wear"];
const categoryImages = ["/products/kumo.webp", "/products/nova.webp", "/products/loop.webp"];
const categoryValues: Category[] = ["home", "tech", "wear"];
const trustIcons = [Truck, ShieldCheck, CreditCard];
const shippingIcons = [CreditCard, PackageCheck, Truck];
const serviceIcons = [ShieldCheck, CreditCard, BadgeCheck, Truck];

export default function Home() {
  const [locale, setLocale] = useState<Locale>("en");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<(typeof products)[number] | null>(null);
  const t = copy[locale];

  const cartCount = useMemo(() => Object.values(cart).reduce((sum, value) => sum + value, 0), [cart]);
  const cartTotal = useMemo(() => products.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0), [cart]);
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "all" || product.category === category;
      const matchesSearch = !query || `${product.name} ${product.description[locale]} ${product.detail[locale]}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, locale, search]);

  const scrollToProducts = () => document.querySelector("#products")?.scrollIntoView({ behavior: "smooth" });
  const chooseCategory = (value: Category) => { setCategory(value); setSearch(""); scrollToProducts(); };
  const addToBag = (id: string) => { setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 })); toast.success(t.added); };
  const changeQuantity = (id: string, amount: number) => {
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + amount);
      const result = { ...current, [id]: next };
      if (!next) delete result[id];
      return result;
    });
  };

  useEffect(() => {
    const modelContext = (document as WebMCPDocument).modelContext;
    if (!modelContext) return;
    const controller = new AbortController();
    const tools: WebMCPTool[] = [
      {
        name: "search_hatchway_catalog",
        description: "Search Hatchway products by keyword and optionally filter by category.",
        inputSchema: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: categoryOrder } }, required: ["query"] },
        annotations: { readOnlyHint: true, consequentialHint: false },
        execute: async (input) => {
          const query = typeof input.query === "string" ? input.query : "";
          const requestedCategory = typeof input.category === "string" ? input.category : "all";
          if (categoryOrder.includes(requestedCategory as Category)) setCategory(requestedCategory as Category);
          setSearch(query); scrollToProducts();
          const matches = products.filter((product) => `${product.name} ${product.description.en}`.toLowerCase().includes(query.toLowerCase()));
          return JSON.stringify(matches.map(({ id, name, price, category: productCategory }) => ({ id, name, price, category: productCategory })));
        },
      },
      {
        name: "add_product_to_bag",
        description: "Add a Hatchway catalog product to the shopping bag by product ID.",
        inputSchema: { type: "object", properties: { productId: { type: "string", enum: products.map((product) => product.id) } }, required: ["productId"] },
        annotations: { readOnlyHint: false, consequentialHint: false },
        execute: async (input) => {
          const productId = typeof input.productId === "string" ? input.productId : "";
          const product = products.find((item) => item.id === productId);
          if (!product) return "Product not found.";
          addToBag(productId); return `${product.name} added to the shopping bag.`;
        },
      },
    ];
    void Promise.all(tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal }))).catch(() => undefined);
    return () => controller.abort();
  }, [locale]);

  return (
    <main className="site-shell store-shell">
      <a className="skip-link" href="#products">Skip to products</a>
      <Toaster position="bottom-center" />
      <div className="store-announcement"><strong>{t.announcement}</strong><span>{t.delivery}</span></div>

      <header className="store-header" id="top">
        <div className="store-header-main">
          <a className="brand store-brand" href="#top" aria-label="Hatchway home"><span className="brand-mark" aria-hidden="true">H</span><span>HATCHWAY</span></a>
          <label className="store-search">
            <Search aria-hidden="true" /><span className="sr-only">{t.search}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && scrollToProducts()} placeholder={t.search} />
            <span className="search-shortcut" aria-hidden="true">⌘ K</span>
          </label>
          <div className="store-actions">
            <label className="language-control store-language"><span className="sr-only">Language</span><Globe2 aria-hidden="true" />
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="en">EN · USD</option><option value="zh">中文 · USD</option><option value="es">ES · USD</option></select>
            </label>
            <Sheet>
              <SheetTrigger asChild><Button className="bag-button store-bag" aria-label={`${t.cart}, ${cartCount} items`}><ShoppingBag aria-hidden="true" /><span>{cartCount}</span></Button></SheetTrigger>
              <SheetContent className="cart-sheet">
                <SheetHeader className="cart-header"><SheetTitle className="cart-title">{t.cart}</SheetTitle><SheetDescription>{cartCount ? t.cartDesc : t.empty}</SheetDescription></SheetHeader>
                <div className="cart-items">{products.filter((product) => cart[product.id]).map((product) => (
                  <div className="cart-line" key={product.id}><Image src={product.image} alt={product.name} width={128} height={128} /><div><strong>{product.name}</strong><span>${product.price}</span>
                    <div className="quantity-control" aria-label={`${product.name} quantity`}><button onClick={() => changeQuantity(product.id, -1)} aria-label={`Decrease ${product.name} quantity`}><Minus /></button><span>{cart[product.id]}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label={`Increase ${product.name} quantity`}><Plus /></button></div>
                  </div></div>
                ))}</div>
                <SheetFooter className="cart-footer"><div className="subtotal"><span>{t.subtotal}</span><strong>${cartTotal}</strong></div><Button className="checkout-button" disabled={!cartCount} onClick={() => toast.success("Checkout handoff ready")}>{t.checkout}</Button><div className="payment-marks" aria-label="Accepted payment methods"><span>VISA</span><span>PayPal</span><span>Pay</span><span>支付宝</span></div></SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        <label className="store-search store-search-mobile"><Search aria-hidden="true" /><span className="sr-only">{t.search}</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && scrollToProducts()} placeholder={t.search} /></label>
        <nav className="store-category-nav" aria-label="Shop categories">{categoryOrder.map((item, index) => <button key={item} onClick={() => chooseCategory(item)} aria-pressed={category === item}>{t.categoryNav[index]}</button>)}<a href="#shipping">Shipping & returns</a></nav>
      </header>

      <section className="store-hero" aria-labelledby="store-hero-title">
        <div className="store-hero-copy">
          <p className="store-eyebrow"><Sparkles aria-hidden="true" />{t.eyebrow}</p><h1 id="store-hero-title">{t.title}</h1><p>{t.body}</p>
          <div className="store-hero-actions"><Button onClick={scrollToProducts} className="store-primary-cta">{t.primaryCta}<ArrowRight aria-hidden="true" /></Button><a href="#products">{t.secondaryCta}</a></div>
          <div className="store-offer"><span>{t.heroDeal}</span><strong>{t.heroDealValue}</strong><code>FIRST10</code></div>
        </div>
        <div className="store-hero-collage" aria-label="Featured products"><span className="collage-label">01 / NEW &amp; NOTEWORTHY</span>
          {products.map((product, index) => <button className={`collage-product collage-product-${index + 1}`} key={product.id} onClick={() => setSelectedProduct(product)} aria-label={`${t.quickView}: ${product.name}`}><Image src={product.image} priority={index === 0} alt={product.name} width={680} height={680} /><span>{product.name}</span><strong>${product.price}</strong></button>)}
        </div>
      </section>

      <section className="store-trust-row" aria-label="Shopping benefits">{t.trust.map((item, index) => { const Icon = trustIcons[index]; return <div key={item}><Icon aria-hidden="true" /><span>{item}</span></div>; })}</section>

      <section className="store-categories" aria-labelledby="category-title">
        <div className="store-section-heading"><h2 id="category-title">{t.shopBy}</h2><p>{t.shopByBody}</p></div>
        <div className="store-category-grid">{t.categoryCards.map(([title, body, count], index) => (
          <button className={`store-category-card category-card-${index + 1}`} key={title} onClick={() => chooseCategory(categoryValues[index])}><div><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{body}</p><small>{count}<ArrowRight aria-hidden="true" /></small></div><Image src={categoryImages[index]} alt="" width={700} height={700} /></button>
        ))}</div>
      </section>

      <section className="store-products" id="products" aria-labelledby="products-title">
        <div className="store-products-heading"><div><p>{t.bestKicker}</p><h2 id="products-title">{t.bestTitle}</h2></div><p>{t.bestBody}</p><button onClick={() => { setCategory("all"); setSearch(""); }}>{t.viewAll}<ArrowRight aria-hidden="true" /></button></div>
        <div className="store-product-filters" aria-label="Product filters">{categoryOrder.map((item, index) => <button key={item} onClick={() => setCategory(item)} aria-pressed={category === item}>{t.categoryNav[index]}</button>)}{search && <span>“{search}”</span>}</div>
        <div className="store-product-grid" aria-live="polite">
          {visibleProducts.map((product) => (
            <article className="store-product-card" key={product.id}>
              <button className={`store-product-media store-product-${product.color}`} onClick={() => setSelectedProduct(product)} aria-label={`${t.quickView}: ${product.name}`}><span className="store-product-badge">{product.badge[locale]}</span><Image src={product.image} alt={product.name} width={900} height={900} /><span className="store-quick-view">{t.quickView}</span></button>
              <div className="store-product-rating" aria-label={`${product.rating} ${t.rating}`}><Star aria-hidden="true" fill="currentColor" /><span>{product.rating}</span><span>({product.reviews})</span></div>
              <div className="store-product-copy"><button onClick={() => setSelectedProduct(product)}><h3>{product.name}</h3><p>{product.description[locale]}</p></button><div><strong>${product.price}</strong>{product.compareAt && <del>${product.compareAt}</del>}</div></div>
              <Button className="store-add-button" onClick={() => addToBag(product.id)}><Plus aria-hidden="true" />{t.add}</Button>
            </article>
          ))}
          {!visibleProducts.length && <div className="store-empty"><Search aria-hidden="true" /><p>{t.noResults}</p><Button onClick={() => { setSearch(""); setCategory("all"); }}>{t.clearSearch}</Button></div>}
        </div>
      </section>

      <section className="store-edit" aria-labelledby="edit-title"><div className="store-edit-visual"><Image src="/products/loop.webp" alt="Loop Mini Crossbody featured in the Hatchway edit" width={1000} height={1000} /><span>HATCHWAY / EDIT 09</span></div><div className="store-edit-copy"><p>{t.promoKicker}</p><h2 id="edit-title">{t.promoTitle}</h2><p>{t.promoBody}</p><a href="#products">{t.promoCta}<ArrowRight aria-hidden="true" /></a></div></section>

      <section className="store-shipping" id="shipping" aria-labelledby="shipping-title">
        <div className="store-shipping-heading"><h2 id="shipping-title">{t.shippingTitle}</h2><p>{t.shippingBody}</p></div>
        <div className="store-shipping-grid">{t.shippingSteps.map(([title, body], index) => { const Icon = shippingIcons[index]; return <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><Icon aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>; })}</div>
      </section>

      <section className="store-review" aria-label="Customer review"><div className="store-review-stars" aria-hidden="true">{[0, 1, 2, 3, 4].map((item) => <Star key={item} fill="currentColor" />)}</div><blockquote>“{t.review}”</blockquote><span>{t.reviewer}</span></section>
      <section className="service-strip" aria-label="Service commitments">{t.services.map((service, index) => { const Icon = serviceIcons[index]; return <div key={service}><Icon aria-hidden="true" /><span>{service}</span></div>; })}</section>
      <footer className="store-footer"><a className="brand footer-brand" href="#top"><span className="brand-mark" aria-hidden="true">H</span><span>HATCHWAY</span></a><p>{t.footer}</p><div><a href="#products">Shop</a><a href="#shipping">Shipping</a><a href="/ops">{t.merchant}</a></div></footer>

      <Sheet open={Boolean(selectedProduct)} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <SheetContent className="store-detail-sheet">{selectedProduct && <><div className={`store-detail-media store-product-${selectedProduct.color}`}><Image src={selectedProduct.image} alt={selectedProduct.name} width={900} height={900} /></div><SheetHeader className="store-detail-header"><SheetDescription>{selectedProduct.badge[locale]}</SheetDescription><SheetTitle>{selectedProduct.name}</SheetTitle></SheetHeader><div className="store-detail-body"><div className="store-detail-price"><strong>${selectedProduct.price}</strong>{selectedProduct.compareAt && <del>${selectedProduct.compareAt}</del>}</div><div className="store-product-rating"><Star aria-hidden="true" fill="currentColor" /><span>{selectedProduct.rating}</span><span>({selectedProduct.reviews})</span></div><p>{selectedProduct.detail[locale]}</p><span><PackageCheck aria-hidden="true" />{t.productNote}</span></div><SheetFooter className="store-detail-footer"><Button onClick={() => addToBag(selectedProduct.id)}><ShoppingBag aria-hidden="true" />{t.add} · ${selectedProduct.price}</Button></SheetFooter></>}</SheetContent>
      </Sheet>
    </main>
  );
}
