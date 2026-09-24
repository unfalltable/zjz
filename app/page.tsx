"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Globe2,
  Headphones,
  Link2,
  MapPin,
  Minus,
  PackageCheck,
  Plane,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";

type Locale = "en" | "zh" | "es";
type Category = "all" | "toys" | "tech" | "wear";

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
    delivery: "Worldwide delivery · duties shown before checkout",
    nav: ["New drop", "Objects", "How it ships"],
    seller: "Seller cockpit",
    eyebrow: "Drop 001 · 328 pieces worldwide",
    title: "Objects with their own gravity.",
    body: "Unexpected design goods, packed in Asia and delivered without the usual border drama.",
    price: "$89",
    add: "Add Kumo to bag",
    addShort: "Quick add",
    ship: "Ships in 2–4 days",
    trace: "Door-to-door tracking",
    cart: "Your orbit",
    cartDesc: "Duties and delivery are calculated before payment.",
    checkout: "Continue to checkout",
    subtotal: "Subtotal",
    empty: "Your orbit is empty.",
    added: "Added to your orbit",
    collectionTitle: "Picked from the strange side of good design.",
    collectionBody: "Small-run objects with real materials, clear provenance and useful aftercare.",
    categories: ["All objects", "Art toys", "Design tech", "Wearables"],
    search: "Search objects",
    searchEmpty: "No objects match that search.",
    fulfillKicker: "Three ways to move an order",
    fulfillTitle: "Sell first. Choose the route after.",
    fulfillBody: "Every order carries one clear fulfillment lane, from a marketplace seller in China to your customer overseas.",
    flowTitle: "One calm control room for every messy route.",
    flowBody: "Switch between direct sellers, your own warehouse and approved suppliers without losing the customer promise.",
    ordersToday: "Orders today",
    revenue: "Revenue",
    onTime: "On-time dispatch",
    liveOrders: "Live orders",
    viewAll: "View all orders",
    integrationsTitle: "Connect the stack you already use.",
    integrationsBody: "Commerce, payment, sourcing, support and shipping are modular—not welded into one vendor.",
    connected: "Connected",
    ready: "Ready to connect",
    footer: "Objects from Asia, carefully sent everywhere.",
  },
  zh: {
    delivery: "全球配送 · 结账前显示税费",
    nav: ["新品发售", "潮流好物", "如何发货"],
    seller: "商家控制台",
    eyebrow: "首发系列 · 全球限量 328 件",
    title: "自带引力的物件。",
    body: "来自亚洲的意趣设计好物，包装、跨境与追踪都变得简单。",
    price: "$89",
    add: "将 Kumo 加入购物袋",
    addShort: "快速加入",
    ship: "2–4 天内发货",
    trace: "全程门到门追踪",
    cart: "你的购物袋",
    cartDesc: "税费与配送时效将在付款前明确显示。",
    checkout: "继续结账",
    subtotal: "小计",
    empty: "购物袋还是空的。",
    added: "已加入购物袋",
    collectionTitle: "在好设计更古怪的一面，挑选有趣物件。",
    collectionBody: "小批量、真实材质、来源透明，并提供清晰的售后保障。",
    categories: ["全部好物", "艺术潮玩", "设计科技", "穿戴配饰"],
    search: "搜索商品",
    searchEmpty: "没有符合条件的商品。",
    fulfillKicker: "一笔订单，三种发货路径",
    fulfillTitle: "先卖出去，再选择最合适的路线。",
    fulfillBody: "从国内平台卖家到海外顾客，每个订单都有清晰、可追踪的履约路径。",
    flowTitle: "一间清晰的控制室，管理所有复杂路径。",
    flowBody: "在平台卖家、自有仓和合作供应商之间灵活切换，同时保证客户体验。",
    ordersToday: "今日订单",
    revenue: "销售额",
    onTime: "准时发货率",
    liveOrders: "实时订单",
    viewAll: "查看全部订单",
    integrationsTitle: "连接你已经在使用的平台。",
    integrationsBody: "电商、支付、采购、客服和物流都可以按模块扩展，不被单一供应商锁定。",
    connected: "已连接",
    ready: "可接入",
    footer: "来自亚洲的好物，认真送往世界各地。",
  },
  es: {
    delivery: "Envío mundial · impuestos visibles antes de pagar",
    nav: ["Nuevo drop", "Objetos", "Cómo enviamos"],
    seller: "Panel de vendedor",
    eyebrow: "Drop 001 · 328 piezas en el mundo",
    title: "Objetos con gravedad propia.",
    body: "Diseño inesperado, preparado en Asia y entregado sin dramas fronterizos.",
    price: "$89",
    add: "Añadir Kumo a la bolsa",
    addShort: "Añadir",
    ship: "Envío en 2–4 días",
    trace: "Seguimiento puerta a puerta",
    cart: "Tu órbita",
    cartDesc: "Impuestos y entrega se calculan antes del pago.",
    checkout: "Continuar al pago",
    subtotal: "Subtotal",
    empty: "Tu órbita está vacía.",
    added: "Añadido a tu órbita",
    collectionTitle: "Elegido del lado extraño del buen diseño.",
    collectionBody: "Objetos de series pequeñas, materiales reales, origen claro y buen cuidado posterior.",
    categories: ["Todos", "Art toys", "Tecnología", "Accesorios"],
    search: "Buscar objetos",
    searchEmpty: "Ningún objeto coincide con la búsqueda.",
    fulfillKicker: "Tres formas de mover un pedido",
    fulfillTitle: "Vende primero. Elige la ruta después.",
    fulfillBody: "Cada pedido sigue una ruta clara, desde un vendedor en China hasta tu cliente internacional.",
    flowTitle: "Un centro de control sereno para cada ruta compleja.",
    flowBody: "Cambia entre vendedores directos, almacén propio y proveedores sin perder la promesa al cliente.",
    ordersToday: "Pedidos de hoy",
    revenue: "Ingresos",
    onTime: "Despacho puntual",
    liveOrders: "Pedidos activos",
    viewAll: "Ver todos",
    integrationsTitle: "Conecta las herramientas que ya usas.",
    integrationsBody: "Comercio, pagos, compras, soporte y envíos son módulos abiertos, no una caja cerrada.",
    connected: "Conectado",
    ready: "Listo para conectar",
    footer: "Objetos de Asia, enviados con cuidado a todo el mundo.",
  },
} as const;

const products = [
  {
    id: "kumo",
    name: "Kumo Cloud Cat",
    price: 89,
    category: "toys" as Category,
    image: "/products/kumo.webp",
    color: "blue",
    badge: { en: "Limited 328", zh: "限量 328", es: "Edición 328" },
    description: { en: "Soft-touch vinyl · NFC passport", zh: "亲肤软胶 · NFC 收藏证书", es: "Vinilo suave · pasaporte NFC" },
  },
  {
    id: "nova",
    name: "Nova Orb",
    price: 129,
    category: "tech" as Category,
    image: "/products/nova.webp",
    color: "ice",
    badge: { en: "New signal", zh: "新品上线", es: "Nueva señal" },
    description: { en: "Spatial speaker · 12-hour play", zh: "空间音响 · 12 小时续航", es: "Audio espacial · 12 horas" },
  },
  {
    id: "loop",
    name: "Loop Mini",
    price: 64,
    category: "wear" as Category,
    image: "/products/loop.webp",
    color: "coral",
    badge: { en: "Small batch", zh: "小批量制作", es: "Serie pequeña" },
    description: { en: "Recycled nylon · modular strap", zh: "再生尼龙 · 模块化背带", es: "Nailon reciclado · correa modular" },
  },
];

const fulfillmentModes = [
  {
    id: "market",
    icon: Store,
    title: { en: "Marketplace direct", zh: "国内平台卖家直发", es: "Envío directo del marketplace" },
    description: {
      en: "Buy from PDD or another marketplace. The domestic seller sends the parcel into your cross-border route.",
      zh: "在拼多多等国内平台采购，由平台卖家把包裹直接发入你的跨境履约链路。",
      es: "Compra en un marketplace chino y el vendedor envía el paquete a tu ruta internacional.",
    },
    note: { en: "Best for testing demand", zh: "适合低成本测款", es: "Ideal para validar demanda" },
    steps: {
      en: ["Customer pays", "Purchase task", "Seller dispatches", "Forwarder checks", "Worldwide delivery"],
      zh: ["顾客付款", "生成采购任务", "平台卖家发货", "货代验货", "全球配送"],
      es: ["Cliente paga", "Tarea de compra", "Vendedor envía", "Control logístico", "Entrega global"],
    },
  },
  {
    id: "self",
    icon: Warehouse,
    title: { en: "Pack it yourself", zh: "自主包装发货", es: "Empaque propio" },
    description: {
      en: "You hold stock, finish the unboxing experience and send consolidated parcels to a forwarding partner.",
      zh: "你保管库存并完成品牌包装，再将包裹集中送往合作货代发往海外。",
      es: "Guardas el inventario, preparas la experiencia de marca y entregas al agente logístico.",
    },
    note: { en: "Best for brand control", zh: "适合强化品牌体验", es: "Máximo control de marca" },
    steps: {
      en: ["Order assigned", "Pick inventory", "Brand packing", "Forwarder scan", "Worldwide delivery"],
      zh: ["订单分配", "拣选库存", "品牌包装", "货代入库", "全球配送"],
      es: ["Asignar pedido", "Preparar stock", "Empaque de marca", "Escaneo logístico", "Entrega global"],
    },
  },
  {
    id: "supplier",
    icon: Boxes,
    title: { en: "Supplier managed", zh: "供应商协同发货", es: "Gestionado por proveedor" },
    description: {
      en: "An approved supplier follows your packaging spec, quality checklist and export handoff rules.",
      zh: "合作供应商按照你的包装规范、质检清单和出口交接要求完成履约。",
      es: "Un proveedor aprobado aplica tus normas de empaque, calidad y entrega de exportación.",
    },
    note: { en: "Best for scaling winners", zh: "适合爆款规模化", es: "Ideal para escalar" },
    steps: {
      en: ["Order assigned", "Supplier confirms", "Custom packing", "QC evidence", "Worldwide delivery"],
      zh: ["订单分配", "供应商确认", "定制包装", "质检凭证", "全球配送"],
      es: ["Asignar pedido", "Proveedor confirma", "Empaque propio", "Prueba de calidad", "Entrega global"],
    },
  },
];

const liveOrders = [
  { id: "HW-1842", place: "Vancouver, CA", product: "Kumo Cloud Cat", lane: "PDD direct", status: "Forwarder received", progress: 64 },
  { id: "HW-1841", place: "Paris, FR", product: "Loop Mini", lane: "Self-pack", status: "Ready for pickup", progress: 42 },
  { id: "HW-1839", place: "Sydney, AU", product: "Nova Orb", lane: "Supplier", status: "QC approved", progress: 78 },
];

export default function Home() {
  const [locale, setLocale] = useState<Locale>("en");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const t = copy[locale];

  const cartCount = useMemo(() => Object.values(cart).reduce((sum, value) => sum + value, 0), [cart]);
  const cartTotal = useMemo(
    () => products.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0),
    [cart],
  );
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "all" || product.category === category;
      const matchesSearch = !query || `${product.name} ${product.description[locale]}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, locale, search]);

  const addToBag = (id: string) => {
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    toast.success(t.added);
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
    const modelContext = (document as WebMCPDocument).modelContext;
    if (!modelContext) return;

    const controller = new AbortController();
    const tools: WebMCPTool[] = [
      {
        name: "search_hatchway_catalog",
        description: "Search Hatchway products by keyword and optionally filter by category.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Product name or description keyword." },
            category: { type: "string", enum: ["all", "toys", "tech", "wear"] },
          },
          required: ["query"],
        },
        annotations: { readOnlyHint: true, consequentialHint: false },
        execute: async (input) => {
          const query = typeof input.query === "string" ? input.query : "";
          const requestedCategory = typeof input.category === "string" ? input.category : "all";
          if (["all", "toys", "tech", "wear"].includes(requestedCategory)) setCategory(requestedCategory as Category);
          setSearch(query);
          document.querySelector("#objects")?.scrollIntoView({ behavior: "smooth" });
          const matches = products.filter((product) => product.name.toLowerCase().includes(query.toLowerCase()));
          return JSON.stringify(matches.map(({ id, name, price, category: productCategory }) => ({ id, name, price, category: productCategory })));
        },
      },
      {
        name: "add_product_to_bag",
        description: "Add a Hatchway catalog product to the shopping bag by product ID.",
        inputSchema: {
          type: "object",
          properties: { productId: { type: "string", enum: products.map((product) => product.id) } },
          required: ["productId"],
        },
        annotations: { readOnlyHint: false, consequentialHint: false },
        execute: async (input) => {
          const productId = typeof input.productId === "string" ? input.productId : "";
          const product = products.find((item) => item.id === productId);
          if (!product) return "Product not found.";
          addToBag(productId);
          return `${product.name} added to the shopping bag.`;
        },
      },
    ];

    void Promise.all(tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal }))).catch(() => undefined);
    return () => controller.abort();
  }, [locale]);

  return (
    <main className="site-shell">
      <a className="skip-link" href="#objects">Skip to products</a>
      <Toaster position="bottom-center" />
      <div className="announcement">{t.delivery}</div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Hatchway home">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>HATCHWAY</span>
        </a>

        <nav className="main-nav" aria-label="Primary navigation">
          <a href="#drop">{t.nav[0]}</a>
          <a href="#objects">{t.nav[1]}</a>
          <a href="#shipping">{t.nav[2]}</a>
        </nav>

        <div className="header-actions">
          <label className="language-control">
            <span className="sr-only">Language</span>
            <Globe2 aria-hidden="true" />
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="en">EN</option>
              <option value="zh">中文</option>
              <option value="es">ES</option>
            </select>
          </label>
          <a className="seller-link" href="#flow">{t.seller}</a>
          <Sheet>
            <SheetTrigger asChild>
              <Button className="bag-button" aria-label={`${t.cart}, ${cartCount} items`}>
                <ShoppingBag aria-hidden="true" />
                <span>{cartCount}</span>
              </Button>
            </SheetTrigger>
            <SheetContent className="cart-sheet">
              <SheetHeader className="cart-header">
                <SheetTitle className="cart-title">{t.cart}</SheetTitle>
                <SheetDescription>{cartCount ? t.cartDesc : t.empty}</SheetDescription>
              </SheetHeader>
              <div className="cart-items">
                {products.filter((product) => cart[product.id]).map((product) => (
                  <div className="cart-line" key={product.id}>
                    <Image src={product.image} alt={product.name} width={128} height={128} />
                    <div>
                      <strong>{product.name}</strong>
                      <span>${product.price}</span>
                      <div className="quantity-control" aria-label={`${product.name} quantity`}>
                        <button onClick={() => changeQuantity(product.id, -1)} aria-label={`Decrease ${product.name} quantity`}><Minus /></button>
                        <span>{cart[product.id]}</span>
                        <button onClick={() => changeQuantity(product.id, 1)} aria-label={`Increase ${product.name} quantity`}><Plus /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <SheetFooter className="cart-footer">
                <div className="subtotal"><span>{t.subtotal}</span><strong>${cartTotal}</strong></div>
                <Button className="checkout-button" disabled={!cartCount} onClick={() => toast.success("Checkout handoff ready")}>{t.checkout}</Button>
                <div className="payment-marks" aria-label="Accepted payment methods"><span>VISA</span><span>PayPal</span><span>Pay</span><span>支付宝</span></div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-eyebrow"><Sparkles aria-hidden="true" /> {t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className="hero-body">{t.body}</p>
          <div className="hero-purchase">
            <Button onClick={() => addToBag("kumo")} className="add-button">{t.add}<span>{t.price}</span></Button>
          </div>
          <div className="micro-trust"><span>{t.ship}</span><span>{t.trace}</span></div>
        </div>

        <div className="hero-stage" id="drop">
          <div className="orbit orbit-one" aria-hidden="true" />
          <div className="orbit orbit-two" aria-hidden="true" />
          <span className="edition-tag">001 / KUMO</span>
          <Image className="hero-product" src="/products/kumo.webp" priority alt="Kumo, a cloud cat astronaut collectible" width={1200} height={1200} />
          <div className="passport-card">
            <span>HATCH ID</span>
            <strong>HW–001–K</strong>
            <small>Authenticity passport included</small>
          </div>
        </div>
      </section>

      <section className="collection-section" id="objects">
        <div className="section-heading collection-heading">
          <h2>{t.collectionTitle}</h2>
          <p>{t.collectionBody}</p>
        </div>
        <div className="shop-controls">
          <div className="category-filters" aria-label="Product categories">
            {(["all", "toys", "tech", "wear"] as Category[]).map((item, index) => (
              <button key={item} onClick={() => setCategory(item)} aria-pressed={category === item}>{t.categories[index]}</button>
            ))}
          </div>
          <label className="search-box">
            <Search aria-hidden="true" />
            <span className="sr-only">{t.search}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} />
          </label>
        </div>
        <div className="product-grid" aria-live="polite">
          {visibleProducts.map((product, index) => (
            <article className={`product-card product-${product.color} ${index === 0 ? "product-featured" : ""}`} key={product.id}>
              <div className="product-media">
                <span className="product-badge">{product.badge[locale]}</span>
                <Image src={product.image} alt={product.name} width={900} height={900} />
                <Button onClick={() => addToBag(product.id)} className="quick-add" aria-label={`${t.addShort} ${product.name}`}>
                  <Plus aria-hidden="true" /> {t.addShort}
                </Button>
              </div>
              <div className="product-copy">
                <div><h3>{product.name}</h3><p>{product.description[locale]}</p></div>
                <strong>${product.price}</strong>
              </div>
            </article>
          ))}
          {!visibleProducts.length && <div className="product-empty"><Search aria-hidden="true" /><p>{t.searchEmpty}</p></div>}
        </div>
      </section>

      <section className="shipping-section" id="shipping">
        <div className="shipping-intro">
          <p className="section-kicker">{t.fulfillKicker}</p>
          <h2>{t.fulfillTitle}</h2>
          <p>{t.fulfillBody}</p>
        </div>
        <Tabs defaultValue="market" className="fulfillment-tabs">
          <TabsList className="fulfillment-tab-list">
            {fulfillmentModes.map((mode) => {
              const Icon = mode.icon;
              return <TabsTrigger key={mode.id} value={mode.id}><Icon aria-hidden="true" /><span>{mode.title[locale]}</span></TabsTrigger>;
            })}
          </TabsList>
          {fulfillmentModes.map((mode) => {
            const Icon = mode.icon;
            return (
              <TabsContent key={mode.id} value={mode.id} className="fulfillment-panel">
                <div className="lane-description">
                  <div className="lane-icon"><Icon aria-hidden="true" /></div>
                  <div><h3>{mode.title[locale]}</h3><p>{mode.description[locale]}</p><span>{mode.note[locale]}</span></div>
                </div>
                <div className="route-map">
                  {mode.steps[locale].map((step, index) => (
                    <div className="route-step" key={step}>
                      <span>{index + 1}</span><strong>{step}</strong>{index < mode.steps[locale].length - 1 && <ChevronRight aria-hidden="true" />}
                    </div>
                  ))}
                </div>
                <div className="route-proof">
                  <span><CheckCircle2 aria-hidden="true" /> Auto status sync</span>
                  <span><ShieldCheck aria-hidden="true" /> Evidence at every handoff</span>
                  <span><Globe2 aria-hidden="true" /> 40+ destination markets</span>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </section>

      <section className="flow-section" id="flow">
        <div className="flow-copy">
          <p className="section-kicker">HATCHWAY FLOW</p>
          <h2>{t.flowTitle}</h2>
          <p>{t.flowBody}</p>
          <div className="flow-metrics">
            <div><strong>24</strong><span>{t.ordersToday}</span></div>
            <div><strong>$5,840</strong><span>{t.revenue}</span></div>
            <div><strong>98.4%</strong><span>{t.onTime}</span></div>
          </div>
        </div>
        <div className="flow-console">
          <div className="console-topbar">
            <div><span className="live-dot" /> {t.liveOrders}</div>
            <button>{t.viewAll}<ArrowUpRight aria-hidden="true" /></button>
          </div>
          <div className="order-list">
            {liveOrders.map((order) => (
              <article className="order-row" key={order.id}>
                <div className="order-id"><span>{order.id}</span><strong>{order.product}</strong></div>
                <div className="order-place"><MapPin aria-hidden="true" />{order.place}</div>
                <span className="lane-pill">{order.lane}</span>
                <div className="order-progress"><span>{order.status}</span><Progress value={order.progress} /></div>
              </article>
            ))}
          </div>
          <div className="console-footer">
            <div className="route-signal"><Store aria-hidden="true" /><span>PDD direct</span><strong>08</strong></div>
            <div className="route-signal"><Warehouse aria-hidden="true" /><span>Self-pack</span><strong>11</strong></div>
            <div className="route-signal"><Boxes aria-hidden="true" /><span>Supplier</span><strong>05</strong></div>
          </div>
        </div>
      </section>

      <section className="integration-section">
        <div className="section-heading integration-heading"><h2>{t.integrationsTitle}</h2><p>{t.integrationsBody}</p></div>
        <div className="integration-grid">
          <article><div className="integration-logo">多</div><div><strong>PDD</strong><span>{t.connected}</span></div><CheckCircle2 aria-label={t.connected} /></article>
          <article><div className="integration-logo"><Box aria-hidden="true" /></div><div><strong>Shopify</strong><span>{t.connected}</span></div><CheckCircle2 aria-label={t.connected} /></article>
          <article><div className="integration-logo"><CircleDot aria-hidden="true" /></div><div><strong>Stripe</strong><span>{t.connected}</span></div><CheckCircle2 aria-label={t.connected} /></article>
          <article><div className="integration-logo"><Plane aria-hidden="true" /></div><div><strong>4PX</strong><span>{t.ready}</span></div><Plus aria-label={t.ready} /></article>
          <article><div className="integration-logo"><Truck aria-hidden="true" /></div><div><strong>ShipStation</strong><span>{t.ready}</span></div><Plus aria-label={t.ready} /></article>
          <article><div className="integration-logo"><Headphones aria-hidden="true" /></div><div><strong>Gorgias</strong><span>{t.ready}</span></div><Plus aria-label={t.ready} /></article>
        </div>
        <div className="api-strip"><Link2 aria-hidden="true" /><span>Open API · Webhooks · Event stream · Bring your own logistics partner</span><ArrowUpRight aria-hidden="true" /></div>
      </section>

      <section className="service-strip" aria-label="Service commitments">
        <div><ShieldCheck aria-hidden="true" /><span>Buyer protection</span></div>
        <div><PackageCheck aria-hidden="true" /><span>Pre-dispatch evidence</span></div>
        <div><Globe2 aria-hidden="true" /><span>Localized checkout</span></div>
        <div><Truck aria-hidden="true" /><span>One tracking timeline</span></div>
      </section>

      <footer>
        <a className="brand footer-brand" href="#top"><span className="brand-mark" aria-hidden="true">H</span><span>HATCHWAY</span></a>
        <p>{t.footer}</p>
        <div><a href="#objects">Instagram</a><a href="#shipping">Shipping</a><a href="#flow">Seller OS</a></div>
      </footer>
    </main>
  );
}
