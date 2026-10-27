"use client";

import Image from "@/components/product-image";
import { ProductVariantSelector, productOptionCopy } from "@/components/product-options";
import { variantLabel } from "@shared/variants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";
import { ArrowRight, ChevronDown, Globe2, Heart, House, MapPin, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Smartphone, Star, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { CART_STORAGE_KEY, DESTINATION_STORAGE_KEY, FAVORITES_STORAGE_KEY, destinations, type DestinationCode, type StoreCategory, type StoreLocale } from "@shared/catalog";
import { useLiveCatalog, useStoreLocale } from "@/hooks/use-storefront";
import { catalogWindowLimit, expandCatalogWindow } from "@/lib/catalog-window";
import { discoverProducts, hasProductDiscount, productDiscountPercent, productPriceCents, type PriceBand, type ProductCollection, type ProductSort } from "@/lib/product-discovery";
import { storefrontCopy } from "@/lib/storefront-copy";
import { canAddShoppingBagLine, flattenCatalogProducts, listingInventory, parseShoppingBag, productQuantityLimit, readBrowserValue, reconcileShoppingBag, selectProductVariant, scrollWithoutMotion, shoppingBagNeedsReview, writeBrowserValue } from "@/lib/storefront";

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute: (input: Record<string, unknown>) => Promise<string>;
};
type WebMCPDocument = Document & { modelContext?: { registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void> } };

const categoryOrder: StoreCategory[] = ["all", "home", "tech", "wear"];
const categoryIcons = [House, Smartphone, ShoppingBag];
const priceBands: PriceBand[] = ["any", "under-25", "25-50", "50-100", "100-plus"];
const sortOrders: ProductSort[] = ["default", "price-low", "price-high"];
const collectionOrder: ProductCollection[] = ["all", "deals", "saved"];

export default function Home() {
  const router = useRouter();
  const [locale, setLocale] = useStoreLocale();
  const { products, loading: catalogLoading, error: catalogError, reload: reloadCatalog } = useLiveCatalog();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState<StoreCategory>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<ProductSort>("default");
  const [collection, setCollection] = useState<ProductCollection>("all");
  const [priceBand, setPriceBand] = useState<PriceBand>("any");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [productWindow, setProductWindow] = useState({ scope: "", limit: 24 });
  const [destination, setDestination] = useState<DestinationCode>("US");
  const [hydrated, setHydrated] = useState(false);
  const [bagNotice, setBagNotice] = useState<"recovered" | "bagUpdated" | "storageNotice" | null>(null);
  // Keep only an ID: quick view always reflects the latest catalogue price and stock.
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const selectedListing = products.find((product) => product.id === selectedProductId) ?? null;
  const selectedProduct = selectedListing ? selectProductVariant(selectedListing, selectedVariantId) : null;
  const bagProducts = useMemo(() => flattenCatalogProducts(products), [products]);
  const t = storefrontCopy[locale];
  const money = useMemo(() => new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }), [locale]);
  const price = (product: (typeof products)[number]) => `${product.variants?.length ? `${productOptionCopy[locale].from} ` : ""}${money.format(productPriceCents(product) / 100)}`;
  const comparePrice = (product: (typeof products)[number]) => money.format((product.compareAtCents ?? Math.round((product.compareAt ?? 0) * 100)) / 100);
  const cartCount = useMemo(() => Object.values(cart).reduce((sum, value) => sum + value, 0), [cart]);
  const cartTotal = useMemo(() => bagProducts.reduce((sum, product) => sum + productPriceCents(product) * (cart[product.id] ?? 0), 0) / 100, [cart, bagProducts]);
  const savedCount = products.filter((product) => Object.hasOwn(favorites, product.id) && favorites[product.id] === true).length;
  const categoryCounts = categoryOrder.map((value) => products.filter((product) => value === "all" || product.category === value).length);
  const matchingProducts = useMemo(() => discoverProducts(products, { locale, category, query: search, sort: sortOrder, collection, priceBand, inStockOnly, favorites }), [locale, category, search, sortOrder, collection, priceBand, inStockOnly, favorites, products]);
  const productScope = JSON.stringify([locale, category, search.trim().toLowerCase(), sortOrder, collection, priceBand, inStockOnly]);
  const productLimit = catalogWindowLimit(productWindow, productScope);
  const visibleProducts = matchingProducts.slice(0, productLimit);
  const filterCount = Number(category !== "all") + Number(priceBand !== "any") + Number(inStockOnly) + Number(Boolean(search.trim()));
  const collectionLabels = { all: t.all, deals: t.deals, saved: t.favorites };
  const scrollToProducts = () => scrollWithoutMotion(document.querySelector("#products"));
  const openShoppingHelp = () => document.querySelector<HTMLDetailsElement>("#shopping-help")?.setAttribute("open", "");
  const resetFilters = () => { setCategory("all"); setSearch(""); setPriceBand("any"); setInStockOnly(false); setCollection("all"); setSortOrder("default"); };
  const chooseCategory = (value: StoreCategory) => { setCategory(value); setSearch(""); setCollection("all"); scrollToProducts(); };
  const chooseCollection = (value: ProductCollection) => { setCollection(value); scrollToProducts(); };
  const addToBag = useCallback((id: string) => {
    const product = bagProducts.find((item) => item.id === id);
    if (catalogLoading || catalogError || !product || (cart[id] ?? 0) >= productQuantityLimit(product)) {
      toast.error(t.limit);
      return false;
    }
    if (!canAddShoppingBagLine(cart, id)) { toast.error(productOptionCopy[locale].bagFull); return false; }
    setCart((current) => ({ ...current, [id]: Math.min((current[id] ?? 0) + 1, productQuantityLimit(product)) }));
    toast.success(t.added);
    return true;
  }, [cart, catalogError, catalogLoading, bagProducts, locale, t.added, t.limit]);
  const toggleFavorite = (id: string) => setFavorites((current) => ({ ...current, [id]: !current[id] }));
  const changeQuantity = (id: string, amount: number) => {
    setCart((current) => {
      const product = bagProducts.find((item) => item.id === id);
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
        if (storedDestination && Object.hasOwn(destinations, storedDestination)) setDestination(storedDestination);
      } catch { writeBrowserValue(FAVORITES_STORAGE_KEY, null); }
      finally { setHydrated(true); }
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
        name: "search_miova_catalog", description: "Search live MIOVA products by keyword, SKU and optional category.",
        inputSchema: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: categoryOrder } }, required: ["query"] },
        annotations: { readOnlyHint: true, consequentialHint: false },
        execute: async (input) => {
          const query = typeof input.query === "string" ? input.query : "";
          const requested = typeof input.category === "string" && categoryOrder.includes(input.category as StoreCategory) ? input.category as StoreCategory : "all";
          resetFilters(); setCategory(requested); setSearch(query); scrollToProducts();
          const matches = discoverProducts(products, { locale, category: requested, query, sort: "default", collection: "all", priceBand: "any", inStockOnly: false, favorites: {} });
          return JSON.stringify(matches.map(({ id, name, price, category: productCategory }) => ({ id, name, price, currency: "USD", category: productCategory })));
        },
      },
      {
        name: "add_product_to_bag", description: "Add an available MIOVA product to the shopping bag. No charge or reservation.",
        inputSchema: { type: "object", properties: { productId: { type: "string", enum: products.map((product) => product.id) } }, required: ["productId"] },
        annotations: { readOnlyHint: false, consequentialHint: false },
        execute: async (input) => {
          const productId = typeof input.productId === "string" ? input.productId : "";
          const product = products.find((item) => item.id === productId);
          if (!product) return "Product not found.";
          return addToBag(productId) ? `${product.name} added to the shopping bag.` : "Product unavailable or quantity limit reached.";
        },
      },
    ];
    void Promise.all(tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal }))).catch(() => undefined);
    return () => controller.abort();
  }, [addToBag, catalogError, catalogLoading, locale, products]);

  const renderSearch = (mobile = false) => (
    <form className={`market-search${mobile ? " market-search-mobile" : ""}`} role="search" onSubmit={(event) => { event.preventDefault(); scrollToProducts(); }}>
      <label className="sr-only" htmlFor={mobile ? "mobile-product-search" : "product-search"}>{t.search}</label>
      <input id={mobile ? "mobile-product-search" : "product-search"} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} maxLength={200} />
      {search && <button className="market-search-clear" type="button" onClick={() => setSearch("")} aria-label={t.clearSearch}><X aria-hidden="true" /></button>}
      <button className="market-search-submit" type="submit" aria-label={t.searchAction}><Search aria-hidden="true" /><span>{t.searchAction}</span></button>
    </form>
  );

  return (
    <main className="site-shell store-shell market-shell">
      <a className="skip-link" href="#products">{t.skip}</a>
      <Toaster position="bottom-center" />
      <div className="store-announcement"><strong>{t.announcement}</strong><a href="/track">{t.track}<ArrowRight aria-hidden="true" /></a></div>
      <header className="store-header" id="top">
        <div className="store-header-main">
          <a className="brand store-brand" href="/" aria-label="MIOVA 妙物"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA<span className="market-brand-cn">妙物</span></span></a>
          {renderSearch()}
          <div className="store-actions">
            <a className="store-account-link" href="/account" aria-label={locale === "zh" ? "我的账户" : locale === "es" ? "Mi cuenta" : "Account"}><UserRound aria-hidden="true" /><span>{locale === "zh" ? "我的账户" : locale === "es" ? "Mi cuenta" : "Account"}</span></a>
            <label className="store-destination"><MapPin aria-hidden="true" /><span>{t.deliverTo}</span>
              <select value={destination} onChange={(event) => setDestination(event.target.value as DestinationCode)} aria-label={t.deliverTo}>{Object.entries(destinations).map(([code, names]) => <option value={code} key={code}>{names[locale]}</option>)}</select>
            </label>
            <label className="language-control store-language"><span className="sr-only">{t.language}</span><Globe2 aria-hidden="true" /><select aria-label={t.language} value={locale} onChange={(event) => setLocale(event.target.value as StoreLocale)}><option value="en">EN · USD</option><option value="zh">中文 · USD</option><option value="es">ES · USD</option></select></label>
            <Sheet open={bagOpen} onOpenChange={setBagOpen}>
              <SheetTrigger asChild><Button className="bag-button store-bag" aria-label={`${t.cart}, ${cartCount} ${t.items}`}><ShoppingBag aria-hidden="true" /><span>{cartCount}</span></Button></SheetTrigger>
              <SheetContent className="cart-sheet market-sheet" closeLabel={t.close}>
                <SheetHeader className="cart-header"><SheetTitle className="cart-title">{t.cart}</SheetTitle><SheetDescription>{cartCount ? t.cartDesc : t.emptyBody}</SheetDescription></SheetHeader>
                {bagNotice && <p className="store-bag-notice" role="status">{t[bagNotice]}</p>}
                <div className="cart-items">
                  {!cartCount && <div className="market-bag-empty"><ShoppingBag aria-hidden="true" /><h3>{t.empty}</h3><p>{t.emptyBody}</p><Button onClick={() => { setBagOpen(false); scrollToProducts(); }}>{t.continueShopping}</Button></div>}
                  {bagProducts.filter((product) => cart[product.id]).map((product) => (
                    <div className="cart-line" key={product.id}><Image src={product.image} alt={product.name} width={128} height={128} /><div><strong>{product.name}</strong><small>{variantLabel(product.variantAttributes)}</small><span>{price(product)}</span><div className="quantity-control" aria-label={`${product.name} ${variantLabel(product.variantAttributes)} ${t.items}`}><button onClick={() => changeQuantity(product.id, -1)} aria-label={`− ${product.name}`}><Minus aria-hidden="true" /></button><span>{cart[product.id]}</span><button disabled={cart[product.id] >= productQuantityLimit(product)} onClick={() => changeQuantity(product.id, 1)} aria-label={`+ ${product.name}`}><Plus aria-hidden="true" /></button></div></div></div>
                  ))}
                </div>
                {cartCount > 0 && <SheetFooter className="cart-footer"><div className="subtotal"><span>{t.subtotal}</span><strong>{money.format(cartTotal)} <small>USD</small></strong></div><Button className="checkout-button" disabled={catalogLoading || catalogError || shoppingBagNeedsReview(cart, products)} onClick={() => router.push("/checkout")}>{t.checkout}<ArrowRight aria-hidden="true" /></Button><small className="cart-security"><ShieldCheck aria-hidden="true" />{t.secureCheckout}</small></SheetFooter>}
              </SheetContent>
            </Sheet>
          </div>
        </div>
        {renderSearch(true)}
        <nav className="store-category-nav" aria-label={t.categories}>
          {categoryOrder.map((item, index) => <button key={item} onClick={() => chooseCategory(item)} aria-pressed={category === item && collection === "all"}>{t.categoryNav[index]}</button>)}
          <button onClick={() => chooseCollection("deals")} aria-pressed={collection === "deals"}><Tag aria-hidden="true" />{t.deals}</button>
          <button className="market-nav-saved" onClick={() => { resetFilters(); chooseCollection("saved"); }} aria-pressed={collection === "saved"}><Heart aria-hidden="true" />{t.favorites}{hydrated && savedCount > 0 && <span className="market-count">{savedCount}</span>}</button>
        </nav>
      </header>

      <div className="market-content">
        <section className="market-intro"><div><h1>{t.title}</h1><p>{t.body}</p></div><a href="#shopping-help" onClick={openShoppingHelp}><MapPin aria-hidden="true" />{destinations[destination][locale]}<span>{t.shoppingHelp}</span><ChevronDown aria-hidden="true" /></a></section>
        <div className="market-departments" aria-label={t.categories}>{categoryOrder.slice(1).map((value, index) => {
          const Icon = categoryIcons[index];
          const sample = products.find((product) => product.category === value);
          return <button key={value} className="market-department" onClick={() => chooseCategory(value)} aria-pressed={category === value}><Icon aria-hidden="true" /><span><strong>{t.categoryNav[index + 1]}</strong><small>{catalogLoading || catalogError ? t.categoryBody[index] : t.productCount(categoryCounts[index + 1])}</small></span>{sample && <Image src={sample.image} alt="" width={80} height={80} />}<ArrowRight aria-hidden="true" /></button>;
        })}</div>

        <div className="market-catalog-layout">
          <aside className="market-sidebar" aria-label={t.filters}>
            <button className="market-filter-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal aria-hidden="true" />{t.filters}{filterCount > 0 && <span className="market-count">{filterCount}</span>}<ChevronDown aria-hidden="true" /></button>
            <div className="market-filter-body" id="catalog-filters" data-open={filtersOpen}>
              <fieldset className="market-filter-group"><legend>{t.categories}</legend>{categoryOrder.map((value, index) => <button className="market-category-filter" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}><span>{t.categoryNav[index]}</span>{!catalogLoading && !catalogError && <span className="market-count">{categoryCounts[index]}</span>}</button>)}</fieldset>
              <fieldset className="market-filter-group"><legend><label htmlFor="price-filter">{t.budget}</label></legend><select className="market-price-select" id="price-filter" value={priceBand} onChange={(event) => setPriceBand(event.target.value as PriceBand)}>{priceBands.map((value, index) => <option key={value} value={value}>{t.priceBands[index]}</option>)}</select></fieldset>
              <label className="market-stock-toggle"><input type="checkbox" checked={inStockOnly} onChange={(event) => setInStockOnly(event.target.checked)} />{t.inStock}</label>
              <button className="market-filter-reset" onClick={resetFilters}>{t.reset}</button>
            </div>
          </aside>

          <section className="store-products market-results" id="products" aria-labelledby="products-title">
            <div className="market-results-heading"><h2 id="products-title">{search.trim() ? t.searchResults : collection !== "all" ? collectionLabels[collection] : t.categoryNav[categoryOrder.indexOf(category)]}</h2><p role="status" aria-live="polite">{catalogLoading ? t.catalogLoading : catalogError ? "" : t.results(matchingProducts.length)}</p></div>
            <div className="market-toolbar"><div className="market-collections" aria-label={t.browse}>{collectionOrder.map((value) => <button key={value} onClick={() => setCollection(value)} aria-pressed={collection === value}>{collectionLabels[value]}</button>)}</div><label className="store-sort"><span>{t.sort}</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as ProductSort)}>{sortOrders.map((value, index) => <option value={value} key={value}>{t.sortOptions[index]}</option>)}</select></label></div>
            {filterCount > 0 && <div className="market-active-filters">
              {category !== "all" && <button onClick={() => setCategory("all")} aria-label={`${t.removeFilter}: ${t.categoryNav[categoryOrder.indexOf(category)]}`}>{t.categoryNav[categoryOrder.indexOf(category)]}<X aria-hidden="true" /></button>}
              {search.trim() && <button onClick={() => setSearch("")} aria-label={t.clearSearch}>“{search.trim()}”<X aria-hidden="true" /></button>}
              {priceBand !== "any" && <button onClick={() => setPriceBand("any")} aria-label={`${t.removeFilter}: ${t.priceBands[priceBands.indexOf(priceBand)]}`}>{t.priceBands[priceBands.indexOf(priceBand)]}<X aria-hidden="true" /></button>}
              {inStockOnly && <button onClick={() => setInStockOnly(false)}>{t.inStock}<X aria-hidden="true" /></button>}
            </div>}
            {bagNotice && <p className="store-bag-notice" role="status">{t[bagNotice]}</p>}
            <div className="store-product-grid" id="catalog-grid" aria-busy={catalogLoading}>
              {!catalogLoading && !catalogError && visibleProducts.map((product) => {
                const discount = productDiscountPercent(product);
                return <article className="store-product-card" key={product.id}>
                  <button className="store-wishlist" onClick={() => toggleFavorite(product.id)} aria-label={`${favorites[product.id] ? t.saved : t.save}: ${product.name}`} aria-pressed={Boolean(favorites[product.id])}><Heart aria-hidden="true" fill={favorites[product.id] ? "currentColor" : "none"} /></button>
                  <button className={`store-product-media store-product-${product.color}`} onClick={() => { setSelectedProductId(product.id); setSelectedVariantId(null); }} aria-label={`${t.quickView}: ${product.name}`}>
                    {discount !== null && <span className="store-product-badge market-discount">−{discount}%</span>}
                    <Image src={product.image} alt={product.name} width={480} height={480} /><span className="store-quick-view">{t.quickView}</span>
                  </button>
                  <div className="store-product-copy"><a href={`/product/${encodeURIComponent(product.id)}`}><h3>{product.name}</h3><p>{product.description[locale]}</p></a><div><strong>{price(product)}</strong>{!product.variants?.length && hasProductDiscount(product) && <del>{comparePrice(product)}</del>}<span className="market-price-currency">USD</span></div></div>
                  {product.reviews > 0 && product.rating > 0 && <div className="store-product-rating" aria-label={`${product.rating} ${t.rating}`}><Star aria-hidden="true" fill="currentColor" /><span>{product.rating}</span><span>({product.reviews})</span></div>}
                  <p className="market-product-stock" data-available={listingInventory(product) > 0}>{listingInventory(product) > 0 ? t.available : t.soldOut}</p>
                  <Button className="store-add-button" disabled={product.variants?.length ? !listingInventory(product) : (cart[product.id] ?? 0) >= productQuantityLimit(product)} onClick={() => product.variants?.length ? router.push(`/product/${encodeURIComponent(product.id)}`) : addToBag(product.id)} aria-label={`${product.variants?.length ? productOptionCopy[locale].choose : t.add}: ${product.name}`}><Plus aria-hidden="true" />{product.variants?.length ? productOptionCopy[locale].choose : !product.inventory ? t.soldOut : (cart[product.id] ?? 0) >= productQuantityLimit(product) ? t.bagLimit : t.add}</Button>
                </article>;
              })}
              {catalogLoading && <><span className="sr-only" role="status">{t.catalogLoading}</span>{Array.from({ length: 10 }, (_, index) => <div className="market-card-skeleton" key={index} aria-hidden="true"><div /><span /><span /><span /></div>)}</>}
              {!catalogLoading && catalogError && <div className="store-empty" role="alert"><PackageCheck className="market-empty-icon" aria-hidden="true" /><h3>{t.catalogErrorTitle}</h3><p>{t.catalogError}</p><Button onClick={reloadCatalog}>{t.retry}</Button></div>}
              {!catalogLoading && !catalogError && !products.length && <div className="store-empty"><ShoppingBag className="market-empty-icon" aria-hidden="true" /><h3>{t.catalogEmptyTitle}</h3><p>{t.catalogEmpty}</p><Button onClick={reloadCatalog}>{t.retry}</Button></div>}
              {!catalogLoading && !catalogError && products.length > 0 && !visibleProducts.length && <div className="store-empty">{collection === "saved" && savedCount === 0 ? <Heart className="market-empty-icon" aria-hidden="true" /> : <Search className="market-empty-icon" aria-hidden="true" />}<h3>{collection === "saved" && savedCount === 0 ? t.savedEmptyTitle : t.noResultsTitle}</h3><p>{collection === "saved" && savedCount === 0 ? t.savedEmpty : t.noResults}</p><Button onClick={resetFilters}>{t.browse}</Button></div>}
            </div>
            {!catalogLoading && !catalogError && matchingProducts.length > 0 && <div className="store-catalog-pagination"><p role="status" aria-live="polite" aria-atomic="true">{t.showing(visibleProducts.length, matchingProducts.length)}</p>{matchingProducts.length > 24 && <Button className="store-show-more" aria-controls="catalog-grid" disabled={visibleProducts.length >= matchingProducts.length} onClick={() => setProductWindow((window) => expandCatalogWindow(window, productScope, matchingProducts.length))}>{visibleProducts.length < matchingProducts.length ? t.showMore : t.allShown}{visibleProducts.length < matchingProducts.length && <Plus aria-hidden="true" />}</Button>}</div>}
          </section>
        </div>

        <p className="market-shopping-note"><ShieldCheck aria-hidden="true" /><span>{t.delivery}</span><a href="#shopping-help" onClick={openShoppingHelp}>{t.shoppingHelp}</a></p>
        <details className="market-help" id="shopping-help"><summary><h2>{t.shippingTitle}</h2><ChevronDown aria-hidden="true" /></summary><div className="market-help-grid">{t.shippingSteps.map(([title, body]) => <article key={title}><h3>{title}</h3><p>{body}</p></article>)}</div></details>
      </div>

      <footer className="store-footer market-footer"><a className="brand footer-brand" href="#top"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a><p>{t.footer}<small>{t.currency}</small></p><nav aria-label={t.shoppingHelp}><a href="#products" onClick={resetFilters}>{t.all}</a><a href="/track">{t.track}</a><a href="#shopping-help" onClick={openShoppingHelp}>{t.shoppingHelp}</a><a href="#top">{t.backTop}</a></nav></footer>

      <Sheet open={Boolean(selectedProduct)} onOpenChange={(open) => !open && setSelectedProductId(null)}>
        <SheetContent className="store-detail-sheet market-sheet" closeLabel={t.close}>{selectedProduct && <>
          <div className={`store-detail-media store-product-${selectedProduct.color}`}><Image src={selectedProduct.image} alt={selectedProduct.name} width={640} height={640} /></div>
          <SheetHeader className="store-detail-header"><SheetDescription>{t.categoryNav[categoryOrder.indexOf(selectedProduct.category)]}</SheetDescription><SheetTitle>{selectedProduct.name}</SheetTitle></SheetHeader>
          <div className="store-detail-body">{selectedListing && <ProductVariantSelector listing={selectedListing} selectedId={selectedProduct.id} locale={locale} onChange={setSelectedVariantId} />}<div className="store-detail-price"><strong>{price(selectedProduct)}</strong>{hasProductDiscount(selectedProduct) && <del>{comparePrice(selectedProduct)}</del>}<small>USD</small></div><p>{selectedProduct.detail[locale]}</p><span><PackageCheck aria-hidden="true" />{t.productNote}: {selectedProduct.inventory}</span><a className="market-detail-link" href={`/product/${encodeURIComponent(selectedProduct.id)}`}>{t.productPage}<ArrowRight aria-hidden="true" /></a></div>
          <SheetFooter className="store-detail-footer"><Button disabled={catalogLoading || catalogError || (cart[selectedProduct.id] ?? 0) >= productQuantityLimit(selectedProduct)} onClick={() => addToBag(selectedProduct.id)}><ShoppingBag aria-hidden="true" />{selectedProduct.inventory ? t.add : t.soldOut}</Button><Button variant="outline" onClick={() => toggleFavorite(selectedListing!.id)}><Heart aria-hidden="true" fill={favorites[selectedListing!.id] ? "currentColor" : "none"} />{favorites[selectedListing!.id] ? t.saved : t.save}</Button></SheetFooter>
        </>}</SheetContent>
      </Sheet>
    </main>
  );
}
