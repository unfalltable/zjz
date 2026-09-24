"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  CreditCard,
  Fingerprint,
  Globe2,
  Heart,
  Minus,
  PackageCheck,
  PackageOpen,
  Plus,
  Ruler,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
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
    storyKicker: "Meet Kumo",
    storyTitle: "Made to be held. Built to be found.",
    storyBody: "Kumo began as a sketch of a cat drifting above the city. The finished figure keeps the soft shape, adds a pearlescent suit and carries a scannable passport that proves which piece is yours.",
    storyCta: "Shop the first drop",
    specs: [["Material", "Soft-touch vinyl"], ["Height", "22 cm / 8.7 in"], ["Edition", "328 numbered pieces"]],
    shippingKicker: "Worldwide, without the guesswork",
    shippingTitle: "From our shelf to your door.",
    shippingBody: "The total is clear before you pay, every object is checked before dispatch, and one tracking link follows the full trip.",
    shippingSteps: [["Know the total", "Delivery and estimated duties appear before payment."], ["Packed with care", "We inspect the object and protect the collector box."], ["Follow every mile", "Door-to-door tracking stays in one timeline."]],
    review: "The box felt as considered as the object. Kumo arrived perfect—and earlier than the estimate.",
    reviewer: "Maya · London collector",
    reviewMeta: "4.9 average from 327 collectors",
    services: ["Buyer protection", "Authenticity passport", "Localized checkout", "Door-to-door tracking"],
    merchant: "Merchant sign in",
    footer: "Objects from Asia, carefully sent everywhere.",
  },
  zh: {
    delivery: "全球配送 · 结账前显示税费",
    nav: ["新品发售", "潮流好物", "如何发货"],
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
    storyKicker: "认识 Kumo",
    storyTitle: "值得握在手里，也值得被记住。",
    storyBody: "Kumo 最初是一张漂浮在城市上空的猫咪草图。成品保留柔软轮廓，穿上珠光宇航服，并附带可扫描的专属收藏证书。",
    storyCta: "选购首发系列",
    specs: [["材质", "亲肤软胶"], ["高度", "22 厘米"], ["版本", "全球编号 328 件"]],
    shippingKicker: "全球配送，简单透明",
    shippingTitle: "从我们的货架，到你的门口。",
    shippingBody: "付款前显示全部费用，发货前逐件检查，一个链接追踪完整旅程。",
    shippingSteps: [["费用先看清", "付款前展示配送费用与预估税费。"], ["认真包装", "检查商品并保护收藏级外盒。"], ["全程可追踪", "一个时间线查看门到门物流。"]],
    review: "包装和商品一样用心。Kumo 完好到达，而且比预计时间更早。",
    reviewer: "Maya · 伦敦收藏者",
    reviewMeta: "327 位收藏者平均评分 4.9",
    services: ["买家保障", "真伪收藏证书", "本地化结账", "门到门追踪"],
    merchant: "商家登录",
    footer: "来自亚洲的好物，认真送往世界各地。",
  },
  es: {
    delivery: "Envío mundial · impuestos visibles antes de pagar",
    nav: ["Nuevo drop", "Objetos", "Cómo enviamos"],
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
    storyKicker: "Conoce a Kumo",
    storyTitle: "Hecho para tocar. Creado para recordar.",
    storyBody: "Kumo nació como el boceto de un gato flotando sobre la ciudad. La figura conserva su silueta suave, suma un traje perlado y lleva un pasaporte escaneable que identifica tu pieza.",
    storyCta: "Comprar el primer drop",
    specs: [["Material", "Vinilo suave"], ["Altura", "22 cm"], ["Edición", "328 piezas numeradas"]],
    shippingKicker: "Envío mundial, sin dudas",
    shippingTitle: "De nuestra estantería a tu puerta.",
    shippingBody: "Ves el total antes de pagar, revisamos cada objeto antes del envío y un solo enlace sigue todo el viaje.",
    shippingSteps: [["Conoce el total", "Envío e impuestos estimados antes de pagar."], ["Empaque cuidado", "Revisamos el objeto y protegemos la caja."], ["Sigue cada kilómetro", "Seguimiento puerta a puerta en una sola línea de tiempo."]],
    review: "La caja estaba tan cuidada como la pieza. Kumo llegó perfecto y antes de lo previsto.",
    reviewer: "Maya · Coleccionista en Londres",
    reviewMeta: "4,9 de media entre 327 coleccionistas",
    services: ["Protección al comprador", "Pasaporte de autenticidad", "Pago localizado", "Seguimiento completo"],
    merchant: "Acceso de vendedores",
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

const specIcons = [Fingerprint, Ruler, BadgeCheck];
const shippingIcons = [CreditCard, PackageCheck, Truck];
const serviceIcons = [ShieldCheck, Fingerprint, Globe2, Truck];

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

      <section className="story-section" aria-labelledby="story-title">
        <div className="story-visual">
          <span>HW–001–K</span>
          <Image src="/products/kumo.webp" alt="Kumo Cloud Cat collectible shown in profile" width={1000} height={1000} />
        </div>
        <div className="story-copy">
          <p className="section-kicker"><PackageOpen aria-hidden="true" />{t.storyKicker}</p>
          <h2 id="story-title">{t.storyTitle}</h2>
          <p>{t.storyBody}</p>
          <div className="story-specs">
            {t.specs.map(([label, value], index) => {
              const Icon = specIcons[index];
              return <div key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>;
            })}
          </div>
          <a className="story-link" href="#objects">{t.storyCta}<ArrowUpRight aria-hidden="true" /></a>
        </div>
      </section>

      <section className="consumer-shipping" id="shipping" aria-labelledby="shipping-title">
        <div className="consumer-shipping-heading">
          <p className="section-kicker">{t.shippingKicker}</p>
          <h2 id="shipping-title">{t.shippingTitle}</h2>
          <p>{t.shippingBody}</p>
        </div>
        <div className="shipping-steps">
          {t.shippingSteps.map(([title, body], index) => {
            const Icon = shippingIcons[index];
            return (
              <article key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="collector-note" aria-label="Collector review">
        <Heart aria-hidden="true" />
        <blockquote>“{t.review}”</blockquote>
        <div><strong>{t.reviewer}</strong><span>{t.reviewMeta}</span></div>
      </section>

      <section className="service-strip" aria-label="Service commitments">
        {t.services.map((service, index) => {
          const Icon = serviceIcons[index];
          return <div key={service}><Icon aria-hidden="true" /><span>{service}</span></div>;
        })}
      </section>

      <footer>
        <a className="brand footer-brand" href="#top"><span className="brand-mark" aria-hidden="true">H</span><span>HATCHWAY</span></a>
        <p>{t.footer}</p>
        <div><a href="#objects">Instagram</a><a href="#shipping">Shipping</a><a href="/ops">{t.merchant}</a></div>
      </footer>
    </main>
  );
}
