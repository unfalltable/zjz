"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import {
  Boxes,
  PackagePlus,
  RotateCw,
  Route,
  Store,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  FulfillmentMode,
  OpsProduct,
  OpsSnapshot,
} from "@shared/ops-types";

import {
  addStockAction,
  importProductsAction,
  saveProductAction,
} from "./actions";
import { initialOpsActionState } from "./action-state";
import { CommercialConsole } from "./commercial-console";

type Locale = "en" | "zh";
let fallbackOpsLocale: Locale = "en";
const opsLocaleKey = "miova_ops_locale_v1";
function readOpsLocale(): Locale {
  try {
    const value = window.localStorage.getItem(opsLocaleKey);
    if (value === "en" || value === "zh") return value;
  } catch { /* Preferences are optional. */ }
  return fallbackOpsLocale;
}
function subscribeOpsLocale(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("miova-ops-locale", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("miova-ops-locale", listener);
  };
}
function changeOpsLocale(value: Locale) {
  fallbackOpsLocale = value;
  try { window.localStorage.setItem(opsLocaleKey, value); } catch { /* Optional preference. */ }
  window.dispatchEvent(new Event("miova-ops-locale"));
}

type OpsDashboardProps = {
  snapshot: OpsSnapshot;
  databaseAvailable: boolean;
  user: { displayName: string; email: string; signOutPath: string } | null;
  signInPath: string;
  storefrontUrl: string | null;
  selfhostAuth?: boolean;
};

const copy = {
  en: {
    overview: "Overview",
    orders: "Orders",
    inventory: "Inventory",
    fulfillment: "Fulfillment",
    storefront: "Storefront",
    integrations: "Integrations",
    system: "Workspace",
    routeBoard: "Route board",
    routeBoardBody: "Orders are grouped by who touches the parcel next.",
    viewStore: "View storefront",
    live: "Live workspace",
    demo: "Read-only workspace",
    demoBody: "Sign in to save status and inventory changes.",
    unavailable: "Saved data is temporarily unavailable. No demo orders are shown; changes are disabled.",
    signIn: "Sign in to manage",
    signOut: "Sign out",
    selfhostLocked: "Private administration",
    selfhostLoginHelp: "Open the SSH tunnel, then sign in through the private administrator address.",
    selfhostSignOutHelp: "To sign out, close all private browsing windows for this session and disconnect the SSH tunnel. Closing one tab does not clear cached credentials.",
    revenue: "Paid open order value (USD)",
    openOrders: "Open orders",
    available: "Available stock",
    onTime: "Awaiting payment",
    lane: "Fulfillment lanes",
    laneBody: "One order, one owner, one next action.",
    marketplace: "Marketplace direct",
    marketplaceNote: "Seller dispatch",
    self: "Self-pack",
    selfNote: "Pack before cutoff",
    supplier: "Supplier managed",
    supplierNote: "QC evidence",
    active: "active",
    operations: "Operations manifest",
    operationsBody: "Change a handoff only when the parcel has cleared the previous step.",
    allOrders: "Orders",
    stock: "Stock",
    order: "Order",
    customer: "Customer",
    product: "Product",
    route: "Route",
    status: "Status",
    value: "Value",
    nextStep: "Next step",
    save: "Save",
    saving: "Saving",
    sku: "SKU",
    availableStock: "Available",
    reserved: "Reserved",
    inbound: "Inbound",
    defaultRoute: "Default route",
    restock: "Restock",
    updating: "Updating",
    signedInAs: "Signed in as",
    updated: "Updated",
    integrationsTitle: "Connected commerce stack",
    integrationsBody: "Sourcing, payment, shipping and support stay modular as the business grows.",
    connected: "Connected",
    ready: "Not connected",
    openApi: "Commerce API v1 · External integrations and webhooks not yet enabled",
  },
  zh: {
    overview: "运营总览",
    orders: "订单",
    inventory: "库存",
    fulfillment: "履约",
    storefront: "独立站",
    integrations: "平台接入",
    system: "工作台",
    routeBoard: "履约路线板",
    routeBoardBody: "按下一位包裹处理方组织订单。",
    viewStore: "查看前台",
    live: "实时工作区",
    demo: "只读工作区",
    demoBody: "登录后可保存订单状态与库存变更。",
    unavailable: "数据暂不可用，不显示演示订单，修改操作已禁用。",
    signIn: "登录并管理",
    signOut: "退出登录",
    selfhostLocked: "私有管理入口",
    selfhostLoginHelp: "请先建立 SSH 隧道，再通过私有后台地址登录。",
    selfhostSignOutHelp: "退出时关闭本次会话的所有隐私浏览窗口，并断开 SSH 隧道。只关闭一个标签页不会清除登录缓存。",
    revenue: "已付款进行中金额（USD）",
    openOrders: "进行中订单",
    available: "可用库存",
    onTime: "待付款草稿",
    lane: "三条履约路线",
    laneBody: "一笔订单、一位负责人、一个下一步。",
    marketplace: "平台卖家直发",
    marketplaceNote: "等待卖家发货",
    self: "自主包装",
    selfNote: "截单前完成打包",
    supplier: "供应商履约",
    supplierNote: "等待质检凭证",
    active: "笔进行中",
    operations: "订单履约舱单",
    operationsBody: "确认包裹完成上一环节后，再推进状态。",
    allOrders: "订单",
    stock: "库存",
    order: "订单号",
    customer: "顾客",
    product: "商品",
    route: "路线",
    status: "状态",
    value: "金额",
    nextStep: "下一步",
    save: "保存",
    saving: "保存中",
    sku: "SKU",
    availableStock: "可用",
    reserved: "已占用",
    inbound: "在途",
    defaultRoute: "默认路线",
    restock: "入库",
    updating: "更新中",
    signedInAs: "当前账号",
    updated: "更新时间",
    integrationsTitle: "平台接入与扩展",
    integrationsBody: "采购、支付、物流和客服保持模块化，随业务增长灵活扩展。",
    connected: "已连接",
    ready: "尚未接入",
    openApi: "Commerce API v1 · 外部平台与 Webhooks 尚未启用",
  },
} as const;


const laneMeta = {
  marketplace: { icon: Store, className: "marketplace" },
  self: { icon: Warehouse, className: "self" },
  supplier: { icon: Boxes, className: "supplier" },
} as const;


export function OpsDashboard(props: OpsDashboardProps) {
  const locale = useSyncExternalStore(subscribeOpsLocale, readOpsLocale, () => "en" as Locale);
  const editable = Boolean(props.user && props.databaseAvailable);
  const [query, setQuery] = useState("");
  const filtered = props.snapshot.products.filter((product) => `${product.sku} ${product.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stockView = <><div className="admin-search-row"><label>{locale === "zh" ? "搜索商品 / SKU" : "Search products / SKU"}<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{filtered.length} {locale === "zh" ? "个商品" : "products"}</span></div><InventoryTable snapshot={{ ...props.snapshot, products: filtered }} editable={editable} locale={locale} /></>;
  return <CommercialConsole locale={locale} onLocaleChange={changeOpsLocale} editable={editable} databaseAvailable={props.databaseAvailable} user={props.user} signInPath={props.signInPath} selfhostAuth={props.selfhostAuth ?? false} storefrontUrl={props.storefrontUrl} products={<><CatalogTools editable={editable} locale={locale} />{stockView}</>} inventory={stockView} audit={<AuditLog snapshot={props.snapshot} locale={locale} />} />;
}


function InventoryTable({
  snapshot,
  editable,
  locale,
}: {
  snapshot: OpsSnapshot;
  editable: boolean;
  locale: Locale;
}) {
  const t = copy[locale];
  return (
    <div className="ops-table-wrap">
      <Table className="ops-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t.sku}</TableHead>
            <TableHead>{t.product}</TableHead>
            <TableHead>{locale === "zh" ? "售价 / 售卖状态" : "Price / sale status"}</TableHead>
            <TableHead>{t.availableStock}</TableHead>
            <TableHead>{t.reserved}</TableHead>
            <TableHead>{t.inbound}</TableHead>
            <TableHead>{t.defaultRoute}</TableHead>
            <TableHead>{t.updated}</TableHead>
            <TableHead><span className="sr-only">Action</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!snapshot.products.length && <TableRow><TableCell colSpan={9} className="ops-empty">{locale === "zh" ? "暂无商品。可以创建商品或显式导入下架模板，不会自动填入库存。" : "No products. Create one or explicitly import paused templates; stock is never fabricated."}</TableCell></TableRow>}
          {snapshot.products.map((product) => (
            <TableRow key={product.sku}>
              <TableCell className="ops-order-id"><strong>{product.sku}</strong></TableCell>
              <TableCell><strong>{product.name}</strong><ProductEditor product={product} editable={editable} locale={locale} /></TableCell>
              <TableCell><strong>{product.priceCents ? formatMoney(product.priceCents, "USD", locale) : (locale === "zh" ? "未设置售价" : "Price required")}</strong><span className="ops-cell-meta">{product.status === "active" ? (locale === "zh" ? "上架" : "Active") : (locale === "zh" ? "下架" : "Paused")}</span></TableCell>
              <TableCell><strong className="ops-stock-number">{Math.max(0, product.stock - product.reserved)}</strong></TableCell>
              <TableCell>{product.reserved}</TableCell>
              <TableCell>{product.inbound || "—"}</TableCell>
              <TableCell><LaneBadge mode={product.defaultFulfillment} locale={locale} /></TableCell>
              <TableCell>{formatDate(product.updatedAt, locale)}</TableCell>
              <TableCell><StockEditor sku={product.sku} editable={editable} locale={locale} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}


function StockEditor({ sku, editable, locale }: { sku: string; editable: boolean; locale: Locale }) {
  const [state, formAction, pending] = useActionState(addStockAction, initialOpsActionState);
  const t = copy[locale];
  useActionToast(state);
  return (
    <form action={formAction} className="ops-restock-form">
      <input type="hidden" name="sku" value={sku} />
      <Input type="number" name="quantity" min={1} max={1000} step={1} defaultValue={1} required disabled={!editable || pending} aria-label={`${t.restock} ${sku}`} />
      <Input name="note" maxLength={200} disabled={!editable || pending} placeholder={locale === "zh" ? "入库说明（可选）" : "Restock note (optional)"} aria-label={locale === "zh" ? "入库说明" : "Restock note"} />
      <Button className="ops-restock" type="submit" variant="outline" size="sm" disabled={!editable || pending}>
        {pending ? <RotateCw className="ops-spin" aria-hidden="true" /> : <PackagePlus aria-hidden="true" />}
        {pending ? t.updating : t.restock}
      </Button>
      <span className="ops-action-message" role={state.kind === "error" ? "alert" : "status"} aria-atomic="true">{state.message}</span>
    </form>
  );
}

function LaneBadge({ mode, modes, locale }: { mode: FulfillmentMode; modes?: FulfillmentMode[]; locale: Locale }) {
  const t = copy[locale];
  const Icon = laneMeta[mode].icon;
  if (modes && modes.length > 1) {
    return <span className="ops-lane-badge split"><Route aria-hidden="true" />{locale === "zh" ? `拆单 · ${modes.length} 条路线` : `Split · ${modes.length} routes`}</span>;
  }
  return <span className={`ops-lane-badge ${laneMeta[mode].className}`}><Icon aria-hidden="true" />{t[mode]}</span>;
}

function CatalogTools({ editable, locale }: { editable: boolean; locale: Locale }) {
  const [state, action, pending] = useActionState(importProductsAction, initialOpsActionState);
  useActionToast(state);
  return <div className="ops-catalog-tools">
    <details className="ops-product-details"><summary>{locale === "zh" ? "创建商品" : "Create product"}</summary><ProductForm editable={editable} locale={locale} /></details>
    <form action={action}>
      <p>{locale === "zh" ? "需要演示模板？仅导入不存在的 SKU，初始库存为 0、默认下架，不覆盖已有商品或订单。" : "Need starter templates? Only missing SKUs are imported, paused with zero stock. Existing products and orders are preserved."}</p>
      <Button variant="outline" type="submit" disabled={!editable || pending}>{pending ? (locale === "zh" ? "导入中" : "Importing") : (locale === "zh" ? "导入下架模板" : "Import paused templates")}</Button>
      <p className="ops-action-message" role={state.kind === "error" ? "alert" : "status"}>{state.message}</p>
    </form>
  </div>;
}

function ProductEditor({ product, editable, locale }: { product: OpsProduct; editable: boolean; locale: Locale }) {
  return <details className="ops-product-details"><summary>{locale === "zh" ? "编辑商品" : "Edit product"}</summary>
    <ProductForm key={`${product.sku}-${product.version}-${product.updatedAt}`} product={product} editable={editable} locale={locale} />
  </details>;
}

function ProductForm({ product, editable, locale }: { product?: OpsProduct; editable: boolean; locale: Locale }) {
  const [state, action, pending] = useActionState(saveProductAction, initialOpsActionState);
  useActionToast(state);
  const zh = locale === "zh";
  return <form action={action} className="ops-product-form">
    <input type="hidden" name="mode" value={product ? "edit" : "create"} />
    {product?.version !== undefined && <input type="hidden" name="expectedVersion" value={product.version} />}
    <fieldset disabled={!editable || pending}>
      <legend>{product ? `${zh ? "商品资料" : "Product settings"}: ${product.sku}` : (zh ? "新商品初始下架，库存为 0" : "New products start paused with zero stock")}</legend>
      <label>SKU<Input name="sku" defaultValue={product?.sku ?? ""} readOnly={Boolean(product)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" /></label>
      <label>{zh ? "商品 URL 标识" : "Product URL ID"}<Input name="storefrontId" defaultValue={product?.storefrontId ?? product?.sku.toLowerCase() ?? ""} required maxLength={64} pattern="[a-z0-9][a-z0-9-]{0,63}" /></label>
      <label>{zh ? "商品名称" : "Product name"}<Input name="name" defaultValue={product?.name ?? ""} required maxLength={160} /></label>
      <label>{zh ? "售价（USD）" : "Price (USD)"}<Input name="price" inputMode="decimal" defaultValue={product?.priceCents ? (product.priceCents / 100).toFixed(2) : ""} required pattern="[0-9]{1,6}(\.[0-9]{1,2})?" placeholder="19.90" /></label>
      <label>{zh ? "划线价（可选，需大于售价）" : "Compare-at (optional, above price)"}<Input name="compareAt" inputMode="decimal" defaultValue={product?.compareAtCents ? (product.compareAtCents / 100).toFixed(2) : ""} pattern="[0-9]{1,6}(\.[0-9]{1,2})?" /></label>
      <label>{zh ? "分类" : "Category"}<NativeSelect name="category" defaultValue={product?.category ?? "home"}><NativeSelectOption value="home">{zh ? "生活家居" : "Home & living"}</NativeSelectOption><NativeSelectOption value="tech">{zh ? "数码" : "Tech"}</NativeSelectOption><NativeSelectOption value="wear">{zh ? "服饰配件" : "Style & accessories"}</NativeSelectOption></NativeSelect></label>
      <label>{zh ? "图片地址（HTTPS 或 /products/）" : "Image URL (HTTPS or /products/)"}<Input name="image" defaultValue={product?.image ?? ""} required maxLength={2048} placeholder="https://…/product.webp" /></label>
      <label>{zh ? "单件物流重量（克，含包装）" : "Shipping weight per unit (grams, packed)"}<Input name="shippingWeightGrams" type="number" min={1} max={1000000} step={1} required defaultValue={(product as OpsProduct & { shippingWeightGrams?: number } | undefined)?.shippingWeightGrams ?? 500} /></label>
      <input type="hidden" name="color" value={product?.metadata?.color ?? "blue"} />
      {(["en", "zh", "es"] as const).map((language) => <div className="ops-product-copy" key={language}>
        <input type="hidden" name={`badge_${language}`} value={product?.metadata?.badge[language] ?? ""} />
        <label>{zh ? "商品简介" : "Description"} · {language.toUpperCase()}<textarea name={`description_${language}`} rows={2} maxLength={5000} defaultValue={product?.metadata?.description[language] ?? ""} /></label>
        <label>{zh ? "商品详情" : "Details"} · {language.toUpperCase()}<textarea name={`detail_${language}`} rows={3} maxLength={5000} defaultValue={product?.metadata?.detail[language] ?? ""} /></label>
      </div>)}
      <p className="ops-field-note">{zh ? "中文/西语留空时显示英文原文，不会自动翻译。" : "Blank Chinese / Spanish text falls back to English; content is not automatically translated."}</p>
      <label>{zh ? "默认履约路线" : "Default fulfillment lane"}<NativeSelect name="defaultFulfillment" defaultValue={product?.defaultFulfillment ?? "self"}>{(["marketplace", "self", "supplier"] as FulfillmentMode[]).map((mode) => <NativeSelectOption key={mode} value={mode}>{copy[locale][mode]}</NativeSelectOption>)}</NativeSelect></label>
      <label>{zh ? "售卖状态" : "Sale status"}<NativeSelect name="status" defaultValue={product?.status ?? "paused"}>{product && <NativeSelectOption value="active">{zh ? "上架" : "Active"}</NativeSelectOption>}<NativeSelectOption value="paused">{zh ? "下架" : "Paused"}</NativeSelectOption></NativeSelect></label>
      <p className="ops-field-note">{zh ? "上架前确认售价、图片、实际库存和履约能力。不会修改历史订单价格，也不会预占未付款订单库存。" : "Confirm pricing, images, physical stock and fulfillment before activation. Historical order prices are unchanged; pending drafts do not reserve stock."}</p>
      <Button type="submit">{pending ? copy[locale].saving : copy[locale].save}</Button>
    </fieldset>
    <p className="ops-action-message" role={state.kind === "error" ? "alert" : "status"}>{state.message}</p>
  </form>;
}

function AuditLog({ snapshot, locale }: { snapshot: OpsSnapshot; locale: Locale }) {
  const events = snapshot.auditEvents ?? [];
  return <div className="ops-table-wrap"><Table className="ops-table"><TableHeader><TableRow>
    <TableHead>{locale === "zh" ? "时间" : "Time"}</TableHead><TableHead>{locale === "zh" ? "对象" : "Entity"}</TableHead><TableHead>{locale === "zh" ? "操作" : "Action"}</TableHead><TableHead>{locale === "zh" ? "说明" : "Details"}</TableHead>
  </TableRow></TableHeader><TableBody>
    {!events.length && <TableRow><TableCell colSpan={4} className="ops-empty">{locale === "zh" ? "暂无变更记录。此功能仅记录启用后的变更，不伪造历史审计。" : "No audit events. Only changes after this feature is enabled are logged; historical events are not invented."}</TableCell></TableRow>}
    {events.map((event) => <TableRow key={event.id}><TableCell>{formatDate(event.time, locale)}</TableCell><TableCell>{event.entity} · {event.entityId}</TableCell><TableCell>{event.action}</TableCell><TableCell className="ops-audit-details">{event.details ?? "—"}</TableCell></TableRow>)}
  </TableBody></Table></div>;
}

function useActionToast(state: { kind: "idle" | "success" | "error"; message: string; eventId: number }) {
  useEffect(() => {
    if (!state.eventId) return;
    if (state.kind === "success") toast.success(state.message);
    if (state.kind === "error") toast.error(state.message);
  }, [state.eventId, state.kind, state.message]);
}

function formatMoney(cents: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
