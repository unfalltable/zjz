"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CreditCard,
  Globe2,
  Heart,
  MapPin,
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
import {
  CART_STORAGE_KEY,
  DESTINATION_STORAGE_KEY,
  FAVORITES_STORAGE_KEY,
  destinations,
  products,
  type DestinationCode,
  type StoreCategory,
  type StoreLocale,
} from "@/lib/catalog";

type Locale = StoreLocale;
type Category = StoreCategory;
type SortOrder = "featured" | "price-low" | "price-high" | "rating";

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
    deliverTo: "Deliver to",
    sort: "Sort",
    sortOptions: ["Featured", "Price: low to high", "Price: high to low", "Top rated"],
    save: "Save for later",
    saved: "Saved",
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
    promoKicker: "THE MIOVA EDIT",
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
    secureCheckout: "Secure checkout · taxes shown before payment",
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
    deliverTo: "配送至",
    sort: "排序",
    sortOptions: ["综合推荐", "价格从低到高", "价格从高到低", "评分最高"],
    save: "收藏商品",
    saved: "已收藏",
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
    promoKicker: "妙物本周精选",
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
    secureCheckout: "安全结账 · 付款前显示税费",
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
    deliverTo: "Enviar a",
    sort: "Ordenar",
    sortOptions: ["Destacados", "Precio: menor a mayor", "Precio: mayor a menor", "Mejor valorados"],
    save: "Guardar",
    saved: "Guardado",
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
    promoKicker: "LA EDICIÓN MIOVA",
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
    secureCheckout: "Pago seguro · impuestos antes de pagar",
    subtotal: "Subtotal",
    empty: "Tu bolsa está vacía.",
    productNote: "En stock · sale en 2–4 días",
    services: ["Protección al comprador", "Pagos seguros", "Control de calidad", "Seguimiento mundial"],
    footer: "Productos interesantes de Asia, fáciles de comprar desde cualquier lugar.",
    merchant: "Panel de vendedor",
  },
} as const;

const categoryOrder: Category[] = ["all", "home", "tech", "wear"];
const categoryImages = ["/products/kumo.webp", "/products/nova.webp", "/products/loop.webp"];
const categoryValues: Category[] = ["home", "tech", "wear"];
const trustIcons = [Truck, ShieldCheck, CreditCard];
const shippingIcons = [CreditCard, PackageCheck, Truck];
const serviceIcons = [ShieldCheck, CreditCard, BadgeCheck, Truck];

export default function Home() {
  const [locale, setLocale] = useState<Locale>("en");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("featured");
  const [destination, setDestination] = useState<DestinationCode>("US");
  const [hydrated, setHydrated] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<(typeof products)[number] | null>(null);
  const t = copy[locale];

  const cartCount = useMemo(() => Object.values(cart).reduce((sum, value) => sum + value, 0), [cart]);
  const cartTotal = useMemo(() => products.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0), [cart]);
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = products.filter((product) => {
      const matchesCategory = category === "all" || product.category === category;
      const matchesSearch = !query || `${product.name} ${product.description[locale]} ${product.detail[locale]}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
    if (sortOrder === "price-low") return [...filtered].sort((a, b) => a.price - b.price);
    if (sortOrder === "price-high") return [...filtered].sort((a, b) => b.price - a.price);
    if (sortOrder === "rating") return [...filtered].sort((a, b) => b.rating - a.rating);
    return filtered;
  }, [category, locale, search, sortOrder]);

  const scrollToProducts = () => document.querySelector("#products")?.scrollIntoView({ behavior: "smooth" });
  const chooseCategory = (value: Category) => { setCategory(value); setSearch(""); scrollToProducts(); };
  const addToBag = (id: string) => { setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 })); toast.success(t.added); };
  const toggleFavorite = (id: string) => {
    setFavorites((current) => ({ ...current, [id]: !current[id] }));
  };
  const changeQuantity = (id: string, amount: number) => {
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + amount);
      const result = { ...current, [id]: next };
      if (!next) delete result[id];
      return result;
    });
  };

  useEffect(() => {
    try {
      const storedCart = window.localStorage.getItem(CART_STORAGE_KEY);
      const storedFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      const storedDestination = window.localStorage.getItem(DESTINATION_STORAGE_KEY) as DestinationCode | null;
      if (storedCart) setCart(JSON.parse(storedCart));
      if (storedFavorites) setFavorites(JSON.parse(storedFavorites));
      if (storedDestination && storedDestination in destinations) setDestination(storedDestination);
    } catch {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    window.localStorage.setItem(DESTINATION_STORAGE_KEY, destination);
  }, [cart, destination, favorites, hydrated]);

  useEffect(() => {
    const modelContext = (document as WebMCPDocument).modelContext;
    if (!modelContext) return;
    const controller = new AbortController();
    const tools: WebMCPTool[] = [
      {
        name: "search_miova_catalog",
        description: "Search MIOVA products by keyword and optionally filter by category.",
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
        description: "Add a MIOVA catalog product to the shopping bag by product ID.",
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
          <a className="brand store-brand" href="#top" aria-label="MIOVA 妙物 home"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a>
          <label className="store-search">
            <Search aria-hidden="true" /><span className="sr-only">{t.search}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && scrollToProducts()} placeholder={t.search} />
            <span className="search-shortcut" aria-hidden="true">⌘ K</span>
          </label>
          <div className="store-actions">
            <label className="store-destination"><MapPin aria-hidden="true" /><span>{t.deliverTo}</span>
              <select value={destination} onChange={(event) => setDestination(event.target.value as DestinationCode)} aria-label={t.deliverTo}>
                {Object.entries(destinations).map(([code, names]) => <option value={code} key={code}>{names[locale]}</option>)}
              </select>
            </label>
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
                <SheetFooter className="cart-footer"><div className="subtotal"><span>{t.subtotal}</span><strong>${cartTotal.toFixed(2)}</strong></div><Button className="checkout-button" disabled={!cartCount} onClick={() => window.location.assign("/checkout")}>{t.checkout}</Button><small className="cart-security"><ShieldCheck aria-hidden="true" />{t.secureCheckout}</small><div className="payment-marks" aria-label="Accepted payment methods"><span>VISA</span><span>PayPal</span><span>Pay</span><span>支付宝</span></div></SheetFooter>
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
        <div className="store-product-filters" aria-label="Product filters">
          <div>{categoryOrder.map((item, index) => <button key={item} onClick={() => setCategory(item)} aria-pressed={category === item}>{t.categoryNav[index]}</button>)}</div>
          {search && <span>“{search}”</span>}
          <label className="store-sort"><span>{t.sort}</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>{(["featured", "price-low", "price-high", "rating"] as SortOrder[]).map((value, index) => <option value={value} key={value}>{t.sortOptions[index]}</option>)}</select></label>
        </div>
        <div className="store-product-grid" aria-live="polite">
          {visibleProducts.map((product) => (
            <article className="store-product-card" key={product.id}>
              <button className="store-wishlist" onClick={() => toggleFavorite(product.id)} aria-label={favorites[product.id] ? `${t.saved}: ${product.name}` : `${t.save}: ${product.name}`} aria-pressed={Boolean(favorites[product.id])}><Heart aria-hidden="true" fill={favorites[product.id] ? "currentColor" : "none"} /></button>
              <button className={`store-product-media store-product-${product.color}`} onClick={() => setSelectedProduct(product)} aria-label={`${t.quickView}: ${product.name}`}><span className="store-product-badge">{product.badge[locale]}</span><Image src={product.image} alt={product.name} width={900} height={900} /><span className="store-quick-view">{t.quickView}</span></button>
              <div className="store-product-rating" aria-label={`${product.rating} ${t.rating}`}><Star aria-hidden="true" fill="currentColor" /><span>{product.rating}</span><span>({product.reviews})</span></div>
              <div className="store-product-copy"><button onClick={() => setSelectedProduct(product)}><h3>{product.name}</h3><p>{product.description[locale]}</p></button><div><strong>${product.price}</strong>{product.compareAt && <del>${product.compareAt}</del>}</div></div>
              <Button className="store-add-button" onClick={() => addToBag(product.id)}><Plus aria-hidden="true" />{t.add}</Button>
            </article>
          ))}
          {!visibleProducts.length && <div className="store-empty"><Search aria-hidden="true" /><p>{t.noResults}</p><Button onClick={() => { setSearch(""); setCategory("all"); }}>{t.clearSearch}</Button></div>}
        </div>
      </section>

      <section className="store-edit" aria-labelledby="edit-title"><div className="store-edit-visual"><Image src="/products/loop.webp" alt="Loop Mini Crossbody featured in the MIOVA edit" width={1000} height={1000} /><span>MIOVA / EDIT 09</span></div><div className="store-edit-copy"><p>{t.promoKicker}</p><h2 id="edit-title">{t.promoTitle}</h2><p>{t.promoBody}</p><a href="#products">{t.promoCta}<ArrowRight aria-hidden="true" /></a></div></section>

      <section className="store-shipping" id="shipping" aria-labelledby="shipping-title">
        <div className="store-shipping-heading"><h2 id="shipping-title">{t.shippingTitle}</h2><p>{t.shippingBody}</p></div>
        <div className="store-shipping-grid">{t.shippingSteps.map(([title, body], index) => { const Icon = shippingIcons[index]; return <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><Icon aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>; })}</div>
      </section>

      <section className="store-review" aria-label="Customer review"><div className="store-review-stars" aria-hidden="true">{[0, 1, 2, 3, 4].map((item) => <Star key={item} fill="currentColor" />)}</div><blockquote>“{t.review}”</blockquote><span>{t.reviewer}</span></section>
      <section className="service-strip" aria-label="Service commitments">{t.services.map((service, index) => { const Icon = serviceIcons[index]; return <div key={service}><Icon aria-hidden="true" /><span>{service}</span></div>; })}</section>
      <footer className="store-footer"><a className="brand footer-brand" href="#top"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a><p>{t.footer}</p><div><a href="#products">Shop</a><a href="#shipping">Shipping</a><a href="/ops">{t.merchant}</a></div></footer>

      <Sheet open={Boolean(selectedProduct)} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <SheetContent className="store-detail-sheet">{selectedProduct && <><div className={`store-detail-media store-product-${selectedProduct.color}`}><Image src={selectedProduct.image} alt={selectedProduct.name} width={900} height={900} /></div><SheetHeader className="store-detail-header"><SheetDescription>{selectedProduct.badge[locale]}</SheetDescription><SheetTitle>{selectedProduct.name}</SheetTitle></SheetHeader><div className="store-detail-body"><div className="store-detail-price"><strong>${selectedProduct.price}</strong>{selectedProduct.compareAt && <del>${selectedProduct.compareAt}</del>}</div><div className="store-product-rating"><Star aria-hidden="true" fill="currentColor" /><span>{selectedProduct.rating}</span><span>({selectedProduct.reviews})</span></div><p>{selectedProduct.detail[locale]}</p><span><PackageCheck aria-hidden="true" />{t.productNote} · {selectedProduct.inventory} available</span></div><SheetFooter className="store-detail-footer"><Button onClick={() => addToBag(selectedProduct.id)}><ShoppingBag aria-hidden="true" />{t.add} · ${selectedProduct.price}</Button><Button variant="outline" onClick={() => toggleFavorite(selectedProduct.id)}><Heart aria-hidden="true" fill={favorites[selectedProduct.id] ? "currentColor" : "none"} />{favorites[selectedProduct.id] ? t.saved : t.save}</Button></SheetFooter></>}</SheetContent>
      </Sheet>
    </main>
  );
}
