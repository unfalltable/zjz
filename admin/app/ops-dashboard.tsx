"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Boxes,
  Cable,
  Check,
  CircleAlert,
  CircleDot,
  Clock3,
  Globe2,
  House,
  Headphones,
  LayoutDashboard,
  LogIn,
  LogOut,
  PackageCheck,
  PackagePlus,
  PanelsTopLeft,
  Plane,
  Plus,
  RotateCw,
  Route,
  ShoppingBag,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import type {
  FulfillmentMode,
  OpsOrder,
  OpsSnapshot,
  OrderStatus,
} from "@shared/ops-types";

import {
  addStockAction,
  initialOpsActionState,
  updateOrderStatusAction,
} from "./actions";

type Locale = "en" | "zh";

type OpsDashboardProps = {
  snapshot: OpsSnapshot;
  databaseAvailable: boolean;
  user: { displayName: string; email: string; signOutPath: string } | null;
  signInPath: string;
  storefrontUrl: string | null;
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
    demo: "Public demo",
    demoBody: "Sign in to save status and inventory changes.",
    unavailable: "Saved data is temporarily unavailable. Showing the demo board.",
    signIn: "Sign in to manage",
    signOut: "Sign out",
    revenue: "Open order value",
    openOrders: "Open orders",
    available: "Available stock",
    onTime: "On-time dispatch",
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
    restock: "Add 10",
    updating: "Updating",
    signedInAs: "Signed in as",
    updated: "Updated",
    integrationsTitle: "Connected commerce stack",
    integrationsBody: "Sourcing, payment, shipping and support stay modular as the business grows.",
    connected: "Connected",
    ready: "Ready to connect",
    openApi: "Open API · Webhooks · Event stream",
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
    demo: "公开演示",
    demoBody: "登录后可保存订单状态与库存变更。",
    unavailable: "持久化数据暂不可用，当前显示演示数据。",
    signIn: "登录并管理",
    signOut: "退出登录",
    revenue: "进行中订单金额",
    openOrders: "进行中订单",
    available: "可用库存",
    onTime: "准时发货率",
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
    restock: "入库 10 件",
    updating: "更新中",
    signedInAs: "当前账号",
    updated: "更新时间",
    integrationsTitle: "平台接入与扩展",
    integrationsBody: "采购、支付、物流和客服保持模块化，随业务增长灵活扩展。",
    connected: "已连接",
    ready: "可接入",
    openApi: "开放 API · Webhooks · 事件流",
  },
} as const;

const statusLabels: Record<Locale, Record<OrderStatus, string>> = {
  en: {
    payment_pending: "Payment pending",
    purchase: "Purchase task",
    packing: "Packing",
    handoff: "Forwarder handoff",
    transit: "International transit",
    delivered: "Delivered",
  },
  zh: {
    payment_pending: "待支付",
    purchase: "采购任务",
    packing: "打包中",
    handoff: "货代交接",
    transit: "国际运输",
    delivered: "已送达",
  },
};

const laneMeta = {
  marketplace: { icon: Store, className: "marketplace" },
  self: { icon: Warehouse, className: "self" },
  supplier: { icon: Boxes, className: "supplier" },
} as const;

const navItems = [
  { id: "route-board", label: "overview", icon: LayoutDashboard },
  { id: "manifest", label: "orders", icon: ShoppingBag },
  { id: "manifest", label: "inventory", icon: PackageCheck },
  { id: "route-board", label: "fulfillment", icon: Route },
  { id: "integrations", label: "integrations", icon: Cable },
] as const;

const integrations = [
  { name: "PDD", group: "Sourcing", icon: Store, connected: false },
  { name: "Shopify", group: "Commerce", icon: ShoppingBag, connected: false },
  { name: "Stripe", group: "Verification pending", icon: CircleDot, connected: false },
  { name: "4PX", group: "Logistics", icon: Plane, connected: false },
  { name: "ShipStation", group: "Shipping", icon: Truck, connected: false },
  { name: "Gorgias", group: "Support", icon: Headphones, connected: false },
] as const;

export function OpsDashboard({
  snapshot,
  databaseAvailable,
  user,
  signInPath,
  storefrontUrl,
}: OpsDashboardProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const t = copy[locale];

  const metrics = useMemo(() => {
    const open = snapshot.orders.filter((order) => order.status !== "delivered");
    const value = open.reduce((sum, order) => sum + order.amountCents, 0);
    const stock = snapshot.products.reduce(
      (sum, product) => sum + Math.max(0, product.stock - product.reserved),
      0
    );
    return { open, value, stock };
  }, [snapshot]);

  const laneCounts = useMemo(
    () =>
      metrics.open.reduce<Record<FulfillmentMode, number>>(
        (counts, order) => {
          order.routeModes.forEach((mode) => {
            counts[mode] += 1;
          });
          return counts;
        },
        { marketplace: 0, self: 0, supplier: 0 }
      ),
    [metrics.open]
  );

  const editable = Boolean(user && databaseAvailable);

  return (
    <SidebarProvider className="ops-shell">
      <a className="skip-link" href="#ops-main">Skip to operations</a>
      <Toaster position="bottom-center" />
      <Sidebar collapsible="offcanvas" className="ops-sidebar">
        <SidebarHeader className="ops-sidebar-header">
          <a href={storefrontUrl ?? "#ops-main"} className="brand ops-brand" aria-label="MIOVA 妙物">
            <span className="brand-mark" aria-hidden="true"><Plane /></span>
            <span>MIOVA 妙物</span>
          </a>
          <span className="ops-console-tag">{t.system}</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="ops-nav-label">Control room</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item, index) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={index === 0} className="ops-nav-item">
                      <a href={`#${item.id}`}>
                        <item.icon aria-hidden="true" />
                        <span>{t[item.label]}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className="ops-nav-item">
                    <a href={storefrontUrl ?? "#ops-main"} aria-disabled={!storefrontUrl}>
                      <House aria-hidden="true" />
                      <span>{t.storefront}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="ops-sidebar-footer">
          {user ? (
            <>
              <div className="ops-user">
                <span>{t.signedInAs}</span>
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
              </div>
              <a className="ops-auth-link" href={user.signOutPath} target="_top">
                <LogOut aria-hidden="true" /> {t.signOut}
              </a>
            </>
          ) : (
            <a className="ops-auth-link ops-auth-primary" href={signInPath} target="_top">
              <LogIn aria-hidden="true" /> {t.signIn}
            </a>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="ops-main" id="ops-main">
        <header className="ops-topbar">
          <div>
            <SidebarTrigger className="ops-sidebar-trigger" aria-label="Open navigation" />
            <div className="ops-breadcrumb"><span>MIOVA 妙物</span><strong>{t.overview}</strong></div>
          </div>
          <div className="ops-top-actions">
            <label className="ops-language">
              <Globe2 aria-hidden="true" />
              <span className="sr-only">Language</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                <option value="en">EN</option>
                <option value="zh">简中</option>
              </select>
            </label>
            <span className={`ops-mode ${editable ? "is-live" : ""}`}>
              {editable ? t.live : t.demo}
            </span>
          </div>
        </header>

        <div className="ops-canvas">
          {!databaseAvailable && (
            <div className="ops-alert" role="status">
              <CircleAlert aria-hidden="true" /> {t.unavailable}
            </div>
          )}
          {!user && (
            <div className="ops-demo-banner">
              <div><PanelsTopLeft aria-hidden="true" /><span>{t.demoBody}</span></div>
              <a href={signInPath} target="_top">{t.signIn}<ArrowUpRight aria-hidden="true" /></a>
            </div>
          )}

          <section className="ops-board" id="route-board" aria-labelledby="route-board-title">
            <div className="ops-board-heading">
              <div>
                <p className="ops-section-code">HW / OPS / 24</p>
                <h1 id="route-board-title">{t.routeBoard}</h1>
                <p>{t.routeBoardBody}</p>
              </div>
              <a className="ops-store-link" href={storefrontUrl ?? "#ops-main"} aria-disabled={!storefrontUrl}>
                {t.viewStore}<ArrowUpRight aria-hidden="true" />
              </a>
            </div>

            <div className="ops-metrics" aria-label="Operations summary">
              <Metric label={t.revenue} value={formatMoney(metrics.value, "USD", locale)} />
              <Metric label={t.openOrders} value={String(metrics.open.length).padStart(2, "0")} />
              <Metric label={t.available} value={String(metrics.stock)} />
              <Metric label={t.onTime} value="97.4%" />
            </div>

            <div className="ops-lane-intro">
              <div><Route aria-hidden="true" /><h2>{t.lane}</h2></div>
              <p>{t.laneBody}</p>
            </div>
            <div className="ops-lanes">
              {(["marketplace", "self", "supplier"] as FulfillmentMode[]).map((mode) => {
                const lane = laneMeta[mode];
                const Icon = lane.icon;
                return (
                  <article className={`ops-lane ${lane.className}`} key={mode}>
                    <div className="ops-lane-marker"><Icon aria-hidden="true" /></div>
                    <div>
                      <h3>{t[mode]}</h3>
                      <p>{t[`${mode}Note` as "marketplaceNote" | "selfNote" | "supplierNote"]}</p>
                    </div>
                    <strong>{laneCounts[mode]}</strong>
                    <span>{t.active}</span>
                    <Truck className="ops-lane-truck" aria-hidden="true" />
                  </article>
                );
              })}
            </div>
          </section>

          <section className="ops-manifest" id="manifest" aria-labelledby="manifest-title">
            <div className="ops-manifest-heading">
              <div>
                <p className="ops-section-code">MANIFEST / LIVE</p>
                <h2 id="manifest-title">{t.operations}</h2>
              </div>
              <p>{t.operationsBody}</p>
            </div>

            <Tabs defaultValue="orders" className="ops-tabs">
              <TabsList variant="line" className="ops-tab-list">
                <TabsTrigger value="orders">{t.allOrders} <span>{snapshot.orders.length}</span></TabsTrigger>
                <TabsTrigger value="inventory">{t.stock} <span>{snapshot.products.length}</span></TabsTrigger>
              </TabsList>
              <TabsContent value="orders">
                <OrdersTable orders={snapshot.orders} editable={editable} locale={locale} />
              </TabsContent>
              <TabsContent value="inventory">
                <InventoryTable snapshot={snapshot} editable={editable} locale={locale} />
              </TabsContent>
            </Tabs>
          </section>

          <section className="ops-integrations" id="integrations" aria-labelledby="integrations-title">
            <div className="ops-integrations-heading">
              <div>
                <p className="ops-section-code">SYSTEM / CONNECTIONS</p>
                <h2 id="integrations-title">{t.integrationsTitle}</h2>
              </div>
              <p>{t.integrationsBody}</p>
            </div>
            <div className="ops-integration-grid">
              {integrations.map((integration) => {
                const Icon = integration.icon;
                return (
                  <article key={integration.name}>
                    <div className="ops-integration-icon"><Icon aria-hidden="true" /></div>
                    <div><strong>{integration.name}</strong><span>{integration.group}</span></div>
                    <span className={integration.connected ? "is-connected" : ""}>
                      {integration.connected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                      {integration.connected ? t.connected : t.ready}
                    </span>
                  </article>
                );
              })}
            </div>
            <div className="ops-api-row"><Cable aria-hidden="true" /><strong>{t.openApi}</strong><ArrowUpRight aria-hidden="true" /></div>
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="ops-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function OrdersTable({
  orders,
  editable,
  locale,
}: {
  orders: OpsOrder[];
  editable: boolean;
  locale: Locale;
}) {
  const t = copy[locale];
  return (
    <div className="ops-table-wrap">
      <Table className="ops-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t.order}</TableHead>
            <TableHead>{t.customer}</TableHead>
            <TableHead>{t.product}</TableHead>
            <TableHead>{t.route}</TableHead>
            <TableHead>{t.status}</TableHead>
            <TableHead>{t.value}</TableHead>
            <TableHead>{t.nextStep}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.orderNumber}>
              <TableCell className="ops-order-id">
                <strong>{order.orderNumber}</strong>
                <span>{formatDate(order.createdAt, locale)}</span>
              </TableCell>
              <TableCell><strong>{order.customerName}</strong><span className="ops-cell-meta">{order.destination}</span></TableCell>
              <TableCell>{order.productName}</TableCell>
              <TableCell><LaneBadge mode={order.fulfillmentMode} modes={order.routeModes} locale={locale} /></TableCell>
              <TableCell className="ops-status-cell">
                <span className={`ops-status-dot status-${order.status}`} aria-hidden="true" />
                <div><strong>{statusLabels[locale][order.status]}</strong><Progress value={order.progress} /></div>
              </TableCell>
              <TableCell><strong>{formatMoney(order.amountCents, order.currency, locale)}</strong></TableCell>
              <TableCell><StatusEditor order={order} editable={editable} locale={locale} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
            <TableHead>{t.availableStock}</TableHead>
            <TableHead>{t.reserved}</TableHead>
            <TableHead>{t.inbound}</TableHead>
            <TableHead>{t.defaultRoute}</TableHead>
            <TableHead>{t.updated}</TableHead>
            <TableHead><span className="sr-only">Action</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.products.map((product) => (
            <TableRow key={product.sku}>
              <TableCell className="ops-order-id"><strong>{product.sku}</strong></TableCell>
              <TableCell><strong>{product.name}</strong></TableCell>
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

function StatusEditor({
  order,
  editable,
  locale,
}: {
  order: OpsOrder;
  editable: boolean;
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState(
    updateOrderStatusAction,
    initialOpsActionState
  );
  const t = copy[locale];
  useActionToast(state);

  if (order.paymentStatus !== "paid") {
    return <span className="ops-payment-lock"><Clock3 aria-hidden="true" />{locale === "zh" ? "等待付款" : "Awaiting payment"}</span>;
  }

  return (
    <form action={formAction} className="ops-inline-form">
      <input type="hidden" name="orderNumber" value={order.orderNumber} />
      <NativeSelect name="status" defaultValue={order.status} disabled={!editable || pending} aria-label={`${t.status} ${order.orderNumber}`}>
        {(Object.keys(statusLabels[locale]) as OrderStatus[]).map((status) => (
          <NativeSelectOption key={status} value={status}>{statusLabels[locale][status]}</NativeSelectOption>
        ))}
      </NativeSelect>
      <Button type="submit" size="sm" disabled={!editable || pending}>
        {pending ? <RotateCw className="ops-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
        {pending ? t.saving : t.save}
      </Button>
      <span className="sr-only" role="status" aria-atomic="true">{state.message}</span>
    </form>
  );
}

function StockEditor({ sku, editable, locale }: { sku: string; editable: boolean; locale: Locale }) {
  const [state, formAction, pending] = useActionState(addStockAction, initialOpsActionState);
  const t = copy[locale];
  useActionToast(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="quantity" value="10" />
      <Button className="ops-restock" type="submit" variant="outline" size="sm" disabled={!editable || pending}>
        {pending ? <RotateCw className="ops-spin" aria-hidden="true" /> : <PackagePlus aria-hidden="true" />}
        {pending ? t.updating : t.restock}
      </Button>
      <span className="sr-only" role="status" aria-atomic="true">{state.message}</span>
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
    maximumFractionDigits: 0,
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
