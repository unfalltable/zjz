"use client";

import Image from "@/components/product-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Clock3,
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
  type DestinationCode,
  type StoreCategory,
  type StoreLocale,
} from "@shared/catalog";
import { useLiveCatalog, useStoreLocale } from "@/hooks/use-storefront";
import { catalogWindowLimit, expandCatalogWindow } from "@/lib/catalog-window";
import { parseShoppingBag, productQuantityLimit, readBrowserValue, reconcileShoppingBag, scrollWithoutMotion, shoppingBagNeedsReview, writeBrowserValue } from "@/lib/storefront";

type Locale = StoreLocale;
type Category = StoreCategory;
type SortOrder = "featured" | "price-low" | "price-high";

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
    announcement: "Discover everyday finds from Asia",
    delivery: "Save a shopping request · no payment collected",
    search: "Search products and categories",
    deliverTo: "Deliver to",
    sort: "Sort",
    sortOptions: ["Featured", "Price: low to high", "Price: high to low"],
    save: "Save for later",
    saved: "Saved",
    categoryNav: ["Shop all", "Home & living", "Tech", "Bags & accessories"],
    eyebrow: "CURATED IN ASIA · DELIVERED WORLDWIDE",
    title: "Good finds. Fewer borders.",
    body: "Useful, unusual and well-made products from independent makers and trusted suppliers—priced clearly and shipped to your door.",
    primaryCta: "Discover products",
    secondaryCta: "Browse the selection",
    trust: ["Shipping estimate before saving", "No payment collected", "Order request tracking"],
    shopBy: "Shop by category",
    shopByBody: "Start with what you need. Stay for what you did not know existed.",
    categoryCards: [
      ["Home & living", "Objects that make a space feel yours"],
      ["Smart tech", "Small upgrades for everyday life"],
      ["Carry & wear", "Light, useful and ready to move"],
    ],
    bestKicker: "Current selection",
    bestTitle: "Discover products",
    bestBody: "Browse the products currently listed in our store.",
    viewAll: "View all products",
    showMore: "Show more products",
    allShown: "All matching products shown",
    showing: (shown: number, total: number) => `Showing ${shown} of ${total} products`,
    add: "Quick add",
    added: "Added to bag",
    quickView: "Quick view",
    productPage: "View full product details",
    rating: "customer rating",
    noResults: "Nothing matched that search. Try ‘speaker’, ‘bag’ or ‘home’.",
    clearSearch: "Clear search",
    catalogLoading: "Loading the latest products…",
    catalogError: "Products are temporarily unavailable. Please try again.",
    catalogEmpty: "No products are available yet. Check back soon.",
    retry: "Try again",
    soldOut: "Currently unavailable",
    limit: "Your bag already has the available quantity (up to 10 per item).",
    bagUpdated: "Your bag was updated because availability changed. Review it before saving.",
    recovered: "Invalid saved bag data was removed. Please review your bag.",
    storageNotice: "This browser cannot save your bag. Keep this page open; saving preferences may be unavailable.",
    promoKicker: "THE MIOVA EDIT",
    promoTitle: "Fresh utility, not more clutter.",
    promoBody: "Every product is selected for usefulness, build quality and a point of view. The assortment can change; the standard does not.",
    promoCta: "Explore the edit",
    shippingTitle: "Know what you are saving.",
    shippingBody: "Online payment is not active yet. A saved request is not a paid order and does not reserve stock or arrange dispatch.",
    shippingSteps: [
      ["Estimated totals", "Review goods and delivery estimates. Import duties are not yet calculated."],
      ["Unpaid request", "Saving charges nothing and does not reserve inventory."],
      ["Check the status", "Use your order number and email to look up the saved request."],
    ],
    cart: "Your bag",
    cartDesc: "This is an unpaid request. Stock is not reserved; import duties are not yet calculated.",
    checkout: "Save order request",
    secureCheckout: "No charge · online payment activation pending",
    track: "Track order",
    subtotal: "Subtotal",
    empty: "Your bag is empty.",
    productNote: "Current availability · stock is not reserved",
    services: ["Clear product information", "Payment activation pending", "No inventory reservation", "Request status tracking"],
    footer: "Interesting goods from Asia, made easy to buy anywhere.",
    merchant: "Merchant console",
  },
  zh: {
    announcement: "发现来自亚洲的日常好物",
    delivery: "保存购物需求 · 不收取付款",
    search: "搜索商品与品类",
    deliverTo: "配送至",
    sort: "排序",
    sortOptions: ["综合推荐", "价格从低到高", "价格从高到低"],
    save: "收藏商品",
    saved: "已收藏",
    categoryNav: ["全部商品", "家居生活", "数码科技", "箱包配饰"],
    eyebrow: "亚洲精选 · 全球送达",
    title: "发现好物，跨境不难。",
    body: "从独立设计者和可信供应商中精选实用、有趣、品质在线的商品，价格清楚，直接送到你家。",
    primaryCta: "发现商品",
    secondaryCta: "浏览当前选品",
    trust: ["保存前查看运费估算", "不收取付款", "订单需求状态查询"],
    shopBy: "按品类逛",
    shopByBody: "从你需要的开始，也可能发现从未想到的好东西。",
    categoryCards: [
      ["家居生活", "让空间更像你的实用好物"],
      ["智能科技", "给日常加一点聪明升级"],
      ["箱包穿戴", "轻巧、实用，随时出发"],
    ],
    bestKicker: "当前选品",
    bestTitle: "发现好物",
    bestBody: "浏览店内目前已上架的商品。",
    viewAll: "查看全部商品",
    showMore: "查看更多商品",
    allShown: "已显示全部匹配商品",
    showing: (shown: number, total: number) => `已显示 ${shown} / ${total} 件商品`,
    add: "快速加入",
    added: "已加入购物袋",
    quickView: "快速查看",
    productPage: "查看完整商品详情",
    rating: "顾客评分",
    noResults: "没有匹配的商品，可以试试“音响”“包”或“家居”。",
    clearSearch: "清除搜索",
    catalogLoading: "正在加载最新商品…",
    catalogError: "商品目录暂时无法加载，请重试。",
    catalogEmpty: "目前暂无可售商品，请稍后再来。",
    retry: "重试",
    soldOut: "暂不可售",
    limit: "购物袋数量已达到当前库存或单件 10 件上限。",
    bagUpdated: "商品库存有变化，已调整购物袋。保存前请重新确认。",
    recovered: "已清理异常的购物袋数据，请重新确认商品。",
    storageNotice: "浏览器无法保存购物袋，请保持页面打开；偏好设置可能无法保留。",
    promoKicker: "妙物本周精选",
    promoTitle: "真正有用，不制造杂物。",
    promoBody: "每件商品都经过实用性、品质与设计感筛选。商品可以更换，但选品标准不会。",
    promoCta: "探索本周精选",
    shippingTitle: "先看清，再保存购物需求。",
    shippingBody: "在线支付尚未开通。保存的是未付款需求，不锁定库存，也不会安排发货。",
    shippingSteps: [
      ["查看估算", "核对商品与运费估算；进口税费尚未计算。"],
      ["未付款需求", "保存不会扣款，也不会占用库存。"],
      ["查询需求状态", "使用订单号与邮箱查看已保存的需求。"],
    ],
    cart: "购物袋",
    cartDesc: "这是未付款需求，不占用库存；进口税费尚未计算。",
    checkout: "保存订单需求",
    secureCheckout: "不会扣款 · 在线支付待资质开通",
    track: "查询订单",
    subtotal: "小计",
    empty: "购物袋还是空的。",
    productNote: "当前可售数量 · 不锁定库存",
    services: ["商品信息清楚", "支付能力待开通", "不锁定库存", "需求状态查询"],
    footer: "亚洲有趣好物，让世界各地都能轻松购买。",
    merchant: "商家工作台",
  },
  es: {
    announcement: "Descubre productos para cada día desde Asia",
    delivery: "Guarda una solicitud · sin cobrar pagos",
    search: "Buscar productos y categorías",
    deliverTo: "Enviar a",
    sort: "Ordenar",
    sortOptions: ["Destacados", "Precio: menor a mayor", "Precio: mayor a menor"],
    save: "Guardar",
    saved: "Guardado",
    categoryNav: ["Ver todo", "Hogar", "Tecnología", "Bolsos y accesorios"],
    eyebrow: "SELECCIONADO EN ASIA · ENVIADO AL MUNDO",
    title: "Buenos hallazgos. Menos fronteras.",
    body: "Productos útiles, originales y bien hechos de creadores independientes y proveedores de confianza, con precios claros y entrega a domicilio.",
    primaryCta: "Descubrir productos",
    secondaryCta: "Ver la selección",
    trust: ["Envío estimado antes de guardar", "Sin cobrar pagos", "Estado de la solicitud"],
    shopBy: "Comprar por categoría",
    shopByBody: "Empieza por lo que necesitas. Quédate por lo inesperado.",
    categoryCards: [
      ["Hogar", "Objetos que hacen tu espacio más tuyo"],
      ["Tecnología", "Pequeñas mejoras para cada día"],
      ["Bolsos y accesorios", "Ligeros, útiles y listos para salir"],
    ],
    bestKicker: "Selección actual",
    bestTitle: "Descubre productos",
    bestBody: "Explora los productos que están disponibles en nuestra tienda.",
    viewAll: "Ver todos",
    showMore: "Ver más productos",
    allShown: "Se muestran todos los resultados",
    showing: (shown: number, total: number) => `${shown} de ${total} productos`,
    add: "Añadir",
    added: "Añadido a la bolsa",
    quickView: "Vista rápida",
    productPage: "Ver todos los detalles",
    rating: "valoración de clientes",
    noResults: "No hay resultados. Prueba ‘altavoz’, ‘bolso’ u ‘hogar’.",
    clearSearch: "Borrar búsqueda",
    catalogLoading: "Cargando los productos actuales…",
    catalogError: "Los productos no están disponibles. Inténtalo de nuevo.",
    catalogEmpty: "Todavía no hay productos disponibles. Vuelve pronto.",
    retry: "Reintentar",
    soldOut: "No disponible",
    limit: "La bolsa alcanzó las existencias disponibles o el límite de 10 unidades.",
    bagUpdated: "Actualizamos la bolsa por cambios de disponibilidad. Revísala antes de guardar.",
    recovered: "Eliminamos datos inválidos de la bolsa guardada. Revisa los productos.",
    storageNotice: "Este navegador no puede guardar la bolsa. Mantén esta página abierta; puede que no se conserven las preferencias.",
    promoKicker: "LA EDICIÓN MIOVA",
    promoTitle: "Utilidad nueva, no más ruido.",
    promoBody: "Elegimos cada producto por su utilidad, calidad y personalidad. El surtido cambia; el estándar no.",
    promoCta: "Explorar la edición",
    shippingTitle: "Revisa lo que estás guardando.",
    shippingBody: "El pago en línea aún no está activo. Guardar una solicitud no cobra, no reserva existencias ni programa el envío.",
    shippingSteps: [
      ["Costes estimados", "Revisa productos y envío. Los aranceles todavía no se calculan."],
      ["Solicitud sin pagar", "Guardar no cobra nada ni reserva existencias."],
      ["Consulta el estado", "Usa el número de pedido y el correo para consultar tu solicitud."],
    ],
    cart: "Tu bolsa",
    cartDesc: "Solicitud sin pagar. No reserva existencias; los aranceles todavía no se calculan.",
    checkout: "Guardar solicitud",
    secureCheckout: "Sin cargo · pago en proceso de activación",
    track: "Seguir pedido",
    subtotal: "Subtotal",
    empty: "Tu bolsa está vacía.",
    productNote: "Disponibilidad actual · existencias sin reservar",
    services: ["Información clara", "Pago pendiente de activación", "Sin reservar existencias", "Estado de la solicitud"],
    footer: "Productos interesantes de Asia, fáciles de comprar desde cualquier lugar.",
    merchant: "Panel de vendedor",
  },
} as const;

const categoryOrder: Category[] = ["all", "home", "tech", "wear"];
const categoryImages = ["/products/kumo.webp", "/products/nova.webp", "/products/loop.webp"];
const categoryValues: Category[] = ["home", "tech", "wear"];
const trustIcons = [Truck, ShieldCheck, Search];
const shippingIcons = [CreditCard, PackageCheck, Truck];
const serviceIcons = [ShieldCheck, Clock3, BadgeCheck, Truck];

export default function Home() {
  const router = useRouter();
  const [locale, setLocale] = useStoreLocale();
  const { products, loading: catalogLoading, error: catalogError, reload: reloadCatalog } = useLiveCatalog();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("featured");
  const [productWindow, setProductWindow] = useState({ scope: "", limit: 24 });
  const [destination, setDestination] = useState<DestinationCode>("US");
  const [hydrated, setHydrated] = useState(false);
  const [bagNotice, setBagNotice] = useState<"recovered" | "bagUpdated" | "storageNotice" | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<(typeof products)[number] | null>(null);
  const t = copy[locale];

  const cartCount = useMemo(() => Object.values(cart).reduce((sum, value) => sum + value, 0), [cart]);
  const cartTotal = useMemo(() => products.reduce((sum, product) => sum + (product.priceCents ?? Math.round(product.price * 100)) * (cart[product.id] ?? 0), 0) / 100, [cart, products]);
  const matchingProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = products.filter((product) => {
      const matchesCategory = category === "all" || product.category === category;
      const matchesSearch = !query || `${product.name} ${product.description[locale]} ${product.detail[locale]}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
    if (sortOrder === "price-low") return [...filtered].sort((a, b) => a.price - b.price);
    if (sortOrder === "price-high") return [...filtered].sort((a, b) => b.price - a.price);
    return filtered;
  }, [category, locale, products, search, sortOrder]);
  // A different search starts at the first group; expanding never changes the bag.
  const productScope = JSON.stringify([locale, category, search.trim().toLowerCase(), sortOrder]);
  const productLimit = catalogWindowLimit(productWindow, productScope);
  const visibleProducts = matchingProducts.slice(0, productLimit);

  const scrollToProducts = () => scrollWithoutMotion(document.querySelector("#products"));
  const chooseCategory = (value: Category) => { setCategory(value); setSearch(""); scrollToProducts(); };
  const addToBag = useCallback((id: string) => {
    const product = products.find((item) => item.id === id);
    if (catalogLoading || catalogError || !product || (cart[id] ?? 0) >= productQuantityLimit(product)) {
      toast.error(t.limit);
      return;
    }
    setCart((current) => ({ ...current, [id]: Math.min((current[id] ?? 0) + 1, productQuantityLimit(product)) }));
    toast.success(t.added);
  }, [cart, catalogError, catalogLoading, products, t.added, t.limit]);
  const toggleFavorite = (id: string) => {
    setFavorites((current) => ({ ...current, [id]: !current[id] }));
  };
  const changeQuantity = (id: string, amount: number) => {
    setCart((current) => {
      const product = products.find((item) => item.id === id);
      const next = Math.max(0, Math.min(product ? productQuantityLimit(product) : 0, (current[id] ?? 0) + amount));
      const result = { ...current, [id]: next };
      if (!next) delete result[id];
      return result;
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const restored = parseShoppingBag(readBrowserValue(CART_STORAGE_KEY));
      const storedFavorites = readBrowserValue(FAVORITES_STORAGE_KEY);
      const storedDestination = readBrowserValue(DESTINATION_STORAGE_KEY) as DestinationCode | null;
      setCart(restored.bag);
      if (restored.recovered) setBagNotice("recovered");
      if (storedFavorites) {
        const parsed: unknown = JSON.parse(storedFavorites);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setFavorites(Object.fromEntries(Object.entries(parsed).filter(([id, saved]) => saved === true && !["__proto__", "constructor", "prototype"].includes(id))));
        }
      }
      if (storedDestination && storedDestination in destinations) setDestination(storedDestination);
    } catch {
      writeBrowserValue(FAVORITES_STORAGE_KEY, null);
    } finally {
      setHydrated(true);
    }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!writeBrowserValue(CART_STORAGE_KEY, JSON.stringify(cart))) queueMicrotask(() => setBagNotice("storageNotice"));
    writeBrowserValue(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    writeBrowserValue(DESTINATION_STORAGE_KEY, destination);
  }, [cart, destination, favorites, hydrated]);

  useEffect(() => {
    if (!hydrated || catalogLoading || catalogError) return;
    const next = reconcileShoppingBag(cart, products);
    if (JSON.stringify(next) === JSON.stringify(cart)) return;
    const timer = window.setTimeout(() => { setCart(next); setBagNotice("bagUpdated"); }, 0);
    return () => window.clearTimeout(timer);
  }, [cart, catalogError, catalogLoading, hydrated, products]);

  useEffect(() => {
    const modelContext = (document as WebMCPDocument).modelContext;
    if (!modelContext || catalogLoading || catalogError || !products.length) return;
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
  }, [addToBag, catalogError, catalogLoading, locale, products]);

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
                {bagNotice && <p className="store-bag-notice" role="status">{t[bagNotice]}</p>}
                <div className="cart-items">{products.filter((product) => cart[product.id]).map((product) => (
                  <div className="cart-line" key={product.id}><Image src={product.image} alt={product.name} width={128} height={128} /><div><strong>{product.name}</strong><span>${product.price}</span>
                    <div className="quantity-control" aria-label={`${product.name} quantity`}><button onClick={() => changeQuantity(product.id, -1)} aria-label={`Decrease ${product.name} quantity`}><Minus aria-hidden="true" /></button><span>{cart[product.id]}</span><button disabled={cart[product.id] >= productQuantityLimit(product)} onClick={() => changeQuantity(product.id, 1)} aria-label={`Increase ${product.name} quantity`}><Plus aria-hidden="true" /></button></div>
                  </div></div>
                ))}</div>
                <SheetFooter className="cart-footer"><div className="subtotal"><span>{t.subtotal}</span><strong>${cartTotal.toFixed(2)}</strong></div><Button className="checkout-button" disabled={!cartCount || catalogLoading || catalogError || shoppingBagNeedsReview(cart, products)} onClick={() => router.push("/checkout")}>{t.checkout}</Button><small className="cart-security"><ShieldCheck aria-hidden="true" />{t.secureCheckout}</small></SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        <label className="store-search store-search-mobile"><Search aria-hidden="true" /><span className="sr-only">{t.search}</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && scrollToProducts()} placeholder={t.search} /></label>
        <nav className="store-category-nav" aria-label="Shop categories">{categoryOrder.map((item, index) => <button key={item} onClick={() => chooseCategory(item)} aria-pressed={category === item}>{t.categoryNav[index]}</button>)}<a href="/track">{t.track}</a><a href="#shipping">Shipping & returns</a></nav>
      </header>

      <section className="store-hero" aria-labelledby="store-hero-title">
        <div className="store-hero-copy">
          <p className="store-eyebrow"><Sparkles aria-hidden="true" />{t.eyebrow}</p><h1 id="store-hero-title">{t.title}</h1><p>{t.body}</p>
          <div className="store-hero-actions"><Button onClick={scrollToProducts} className="store-primary-cta">{t.primaryCta}<ArrowRight aria-hidden="true" /></Button><a href="#products">{t.secondaryCta}</a></div>
          <div className="store-offer"><strong>{t.secureCheckout}</strong></div>
        </div>
        <div className="store-hero-collage" aria-label="Featured products"><span className="collage-label">01 / NEW &amp; NOTEWORTHY</span>
          {products.slice(0, 3).map((product, index) => <button className={`collage-product collage-product-${index + 1}`} key={product.id} onClick={() => setSelectedProduct(product)} aria-label={`${t.quickView}: ${product.name}`}><Image src={product.image} priority={index === 0} alt={product.name} width={680} height={680} /><span>{product.name}</span><strong>${product.price.toFixed(2)}</strong></button>)}
          {!products.length && <p className="store-collage-status" role="status">{catalogLoading ? t.catalogLoading : catalogError ? t.catalogError : t.catalogEmpty}</p>}
        </div>
      </section>

      <section className="store-trust-row" aria-label="Shopping benefits">{t.trust.map((item, index) => { const Icon = trustIcons[index]; return <div key={item}><Icon aria-hidden="true" /><span>{item}</span></div>; })}</section>

      <section className="store-categories" aria-labelledby="category-title">
        <div className="store-section-heading"><h2 id="category-title">{t.shopBy}</h2><p>{t.shopByBody}</p></div>
        <div className="store-category-grid">{t.categoryCards.map(([title, body], index) => (
          <button className={`store-category-card category-card-${index + 1}`} key={title} onClick={() => chooseCategory(categoryValues[index])}><div><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{body}</p><small>{products.filter((product) => product.category === categoryValues[index]).length}<ArrowRight aria-hidden="true" /></small></div><Image src={products.find((product) => product.category === categoryValues[index])?.image ?? categoryImages[index]} alt="" width={700} height={700} /></button>
        ))}</div>
      </section>

      <section className="store-products" id="products" aria-labelledby="products-title">
        <div className="store-products-heading"><div><p>{t.bestKicker}</p><h2 id="products-title">{t.bestTitle}</h2></div><p>{t.bestBody}</p><button onClick={() => { setCategory("all"); setSearch(""); }}>{t.viewAll}<ArrowRight aria-hidden="true" /></button></div>
        <div className="store-product-filters" aria-label="Product filters">
          <div>{categoryOrder.map((item, index) => <button key={item} onClick={() => setCategory(item)} aria-pressed={category === item}>{t.categoryNav[index]}</button>)}</div>
          {search && <span>“{search}”</span>}
          <label className="store-sort"><span>{t.sort}</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>{(["featured", "price-low", "price-high"] as SortOrder[]).map((value, index) => <option value={value} key={value}>{t.sortOptions[index]}</option>)}</select></label>
        </div>
        {bagNotice && <p className="store-bag-notice" role="status">{t[bagNotice]}</p>}
        <div className="store-product-grid" id="catalog-grid" aria-busy={catalogLoading}>
          {visibleProducts.map((product) => (
            <article className="store-product-card" key={product.id}>
              <button className="store-wishlist" onClick={() => toggleFavorite(product.id)} aria-label={favorites[product.id] ? `${t.saved}: ${product.name}` : `${t.save}: ${product.name}`} aria-pressed={Boolean(favorites[product.id])}><Heart aria-hidden="true" fill={favorites[product.id] ? "currentColor" : "none"} /></button>
              <button className={`store-product-media store-product-${product.color}`} onClick={() => setSelectedProduct(product)} aria-label={`${t.quickView}: ${product.name}`}><span className="store-product-badge">{product.badge[locale]}</span><Image src={product.image} alt={product.name} width={900} height={900} /><span className="store-quick-view">{t.quickView}</span></button>
              {product.reviews > 0 && <div className="store-product-rating" aria-label={`${product.rating} ${t.rating}`}><Star aria-hidden="true" fill="currentColor" /><span>{product.rating}</span><span>({product.reviews})</span></div>}
              <div className="store-product-copy"><a href={`/product/${encodeURIComponent(product.id)}`}><h3>{product.name}</h3><p>{product.description[locale]}</p></a><div><strong>${product.price.toFixed(2)}</strong>{product.compareAt && <del>${product.compareAt.toFixed(2)}</del>}</div></div>
              <Button className="store-add-button" disabled={catalogLoading || catalogError || (cart[product.id] ?? 0) >= productQuantityLimit(product)} onClick={() => addToBag(product.id)}><Plus aria-hidden="true" />{product.inventory ? t.add : t.soldOut}</Button>
            </article>
          ))}
          {catalogLoading && <div className="store-empty" role="status"><p>{t.catalogLoading}</p></div>}
          {!catalogLoading && catalogError && <div className="store-empty" role="alert"><p>{t.catalogError}</p><Button onClick={reloadCatalog}>{t.retry}</Button></div>}
          {!catalogLoading && !catalogError && !products.length && <div className="store-empty"><p>{t.catalogEmpty}</p></div>}
          {!catalogLoading && !catalogError && products.length > 0 && !visibleProducts.length && <div className="store-empty"><Search aria-hidden="true" /><p>{t.noResults}</p><Button onClick={() => { setSearch(""); setCategory("all"); }}>{t.clearSearch}</Button></div>}
        </div>
        {!catalogLoading && !catalogError && matchingProducts.length > 0 && (
          <div className="store-catalog-pagination">
            <p role="status" aria-live="polite" aria-atomic="true">{t.showing(visibleProducts.length, matchingProducts.length)}</p>
            {matchingProducts.length > 24 && <Button className="store-show-more" aria-controls="catalog-grid" disabled={visibleProducts.length >= matchingProducts.length} onClick={() => setProductWindow((window) => expandCatalogWindow(window, productScope, matchingProducts.length))}>{visibleProducts.length < matchingProducts.length ? t.showMore : t.allShown}{visibleProducts.length < matchingProducts.length && <Plus aria-hidden="true" />}</Button>}
          </div>
        )}
      </section>

      <section className="store-edit" aria-labelledby="edit-title"><div className="store-edit-visual"><Image src="/products/loop.webp" alt="Loop Mini Crossbody featured in the MIOVA edit" width={1000} height={1000} /><span>MIOVA / EDIT 09</span></div><div className="store-edit-copy"><p>{t.promoKicker}</p><h2 id="edit-title">{t.promoTitle}</h2><p>{t.promoBody}</p><a href="#products">{t.promoCta}<ArrowRight aria-hidden="true" /></a></div></section>

      <section className="store-shipping" id="shipping" aria-labelledby="shipping-title">
        <div className="store-shipping-heading"><h2 id="shipping-title">{t.shippingTitle}</h2><p>{t.shippingBody}</p></div>
        <div className="store-shipping-grid">{t.shippingSteps.map(([title, body], index) => { const Icon = shippingIcons[index]; return <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><Icon aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>; })}</div>
      </section>

      <section className="service-strip" aria-label="Service commitments">{t.services.map((service, index) => { const Icon = serviceIcons[index]; return <div key={service}><Icon aria-hidden="true" /><span>{service}</span></div>; })}</section>
      <footer className="store-footer"><a className="brand footer-brand" href="#top"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a><p>{t.footer}</p><div><a href="#products">Shop</a><a href="#shipping">Shipping</a><a href="/ops">{t.merchant}</a></div></footer>

      <Sheet open={Boolean(selectedProduct)} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <SheetContent className="store-detail-sheet">{selectedProduct && <><div className={`store-detail-media store-product-${selectedProduct.color}`}><Image src={selectedProduct.image} alt={selectedProduct.name} width={900} height={900} /></div><SheetHeader className="store-detail-header"><SheetDescription>{selectedProduct.badge[locale]}</SheetDescription><SheetTitle>{selectedProduct.name}</SheetTitle></SheetHeader><div className="store-detail-body"><div className="store-detail-price"><strong>${selectedProduct.price.toFixed(2)}</strong>{selectedProduct.compareAt && <del>${selectedProduct.compareAt.toFixed(2)}</del>}</div>{selectedProduct.reviews > 0 && <div className="store-product-rating"><Star aria-hidden="true" fill="currentColor" /><span>{selectedProduct.rating}</span><span>({selectedProduct.reviews})</span></div>}<p>{selectedProduct.detail[locale]}</p><span><PackageCheck aria-hidden="true" />{t.productNote} · {selectedProduct.inventory}</span></div><SheetFooter className="store-detail-footer"><Button disabled={catalogLoading || catalogError || (cart[selectedProduct.id] ?? 0) >= productQuantityLimit(selectedProduct)} onClick={() => addToBag(selectedProduct.id)}><ShoppingBag aria-hidden="true" />{selectedProduct.inventory ? t.add : t.soldOut} · ${selectedProduct.price.toFixed(2)}</Button><Button variant="outline" onClick={() => toggleFavorite(selectedProduct.id)}><Heart aria-hidden="true" fill={favorites[selectedProduct.id] ? "currentColor" : "none"} />{favorites[selectedProduct.id] ? t.saved : t.save}</Button></SheetFooter></>}</SheetContent>
      </Sheet>
    </main>
  );
}
