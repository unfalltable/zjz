"use client";

import { useActionState, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  Clock3,
  Globe2,
  MapPin,
  PackageCheck,
  Route,
  Search,
  Truck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { FulfillmentMode, OrderStatus } from "@/lib/ops-types";
import { initialTrackState, lookupOrderAction } from "./actions";

type Locale = "en" | "zh";

const text = {
  en: {
    title: "Track an order.",
    body: "Use the order number and email from checkout.",
    order: "Order number",
    email: "Checkout email",
    submit: "Find order",
    searching: "Finding order…",
    back: "Back to store",
    payment: "Payment pending",
    paymentBody: "Nothing has been charged. The order will enter fulfillment after payment is activated and completed.",
    destination: "Destination",
    delivery: "Delivery",
    route: "Fulfillment route",
    total: "Order total",
    placed: "Saved",
    updated: "Last update",
    marketplace: "Marketplace direct",
    self: "Self-pack",
    supplier: "Supplier managed",
    split: "Split fulfillment",
  },
  zh: {
    title: "查询订单。",
    body: "请输入结账时的订单号与邮箱。",
    order: "订单号",
    email: "结账邮箱",
    submit: "查询订单",
    searching: "查询中…",
    back: "返回商城",
    payment: "待支付",
    paymentBody: "目前未产生扣款。支付能力开通并完成付款后，订单才会进入履约流程。",
    destination: "目的地",
    delivery: "配送方式",
    route: "履约路线",
    total: "订单金额",
    placed: "创建时间",
    updated: "最近更新",
    marketplace: "平台卖家直发",
    self: "自主包装发货",
    supplier: "供应商履约",
    split: "拆单履约",
  },
} as const;

const statusOrder: OrderStatus[] = [
  "payment_pending",
  "purchase",
  "packing",
  "handoff",
  "transit",
  "delivered",
];

const statusText: Record<Locale, Record<OrderStatus, string>> = {
  en: {
    payment_pending: "Payment pending",
    purchase: "Sourcing",
    packing: "Packing",
    handoff: "Forwarder handoff",
    transit: "International transit",
    delivered: "Delivered",
  },
  zh: {
    payment_pending: "待支付",
    purchase: "采购中",
    packing: "打包中",
    handoff: "货代交接",
    transit: "国际运输",
    delivered: "已送达",
  },
};

export function TrackClient({ initialOrderNumber }: { initialOrderNumber: string }) {
  const [state, action, pending] = useActionState(lookupOrderAction, initialTrackState);
  const [locale, setLocale] = useState<Locale>("en");
  const t = text[locale];

  return (
    <main className="track-shell">
      <header className="track-header">
        <a className="brand checkout-brand" href="/" aria-label="MIOVA 妙物 home"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a>
        <label className="track-language"><Globe2 aria-hidden="true" /><span className="sr-only">Language</span><select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="en">EN</option><option value="zh">简中</option></select></label>
      </header>

      <div className="track-grid">
        <section className="track-search" aria-labelledby="track-title">
          <a href="/" className="checkout-back"><ArrowLeft aria-hidden="true" />{t.back}</a>
          <p className="checkout-kicker">MIOVA / TRACKING</p>
          <h1 id="track-title">{t.title}</h1>
          <p className="track-intro">{t.body}</p>
          <form action={action} className="track-form">
            <label className="checkout-field"><span>{t.order}</span><Input name="orderNumber" defaultValue={initialOrderNumber} placeholder="MW-123456" autoComplete="off" required /></label>
            <label className="checkout-field"><span>{t.email}</span><Input name="email" type="email" autoComplete="email" required /></label>
            <Button className="checkout-next" type="submit" disabled={pending}><Search aria-hidden="true" />{pending ? t.searching : t.submit}</Button>
          </form>
          {state.kind !== "idle" && state.kind !== "found" && <div className="track-message" role="alert">{state.message}</div>}
        </section>

        <section className="track-result" aria-live="polite">
          {state.order ? <OrderResult order={state.order} locale={locale} /> : <TrackEmpty locale={locale} />}
        </section>
      </div>
    </main>
  );
}

function TrackEmpty({ locale }: { locale: Locale }) {
  return <div className="track-empty"><Route aria-hidden="true" /><strong>{locale === "zh" ? "订单进度会显示在这里" : "Your order journey will appear here"}</strong><span>{locale === "zh" ? "每个履约节点都会保留清晰状态。" : "Each fulfillment handoff has a clear status."}</span></div>;
}

function OrderResult({ order, locale }: { order: NonNullable<typeof initialTrackState.order>; locale: Locale }) {
  const t = text[locale];
  const currentIndex = statusOrder.indexOf(order.status);
  const routeLabel = order.routeModes.length > 1 ? t.split : t[order.fulfillmentMode];
  return (
    <div className="tracking-card">
      <div className="tracking-card-head"><div><span>{order.orderNumber}</span><h2>{order.productName}</h2></div><strong>{statusText[locale][order.status]}</strong></div>
      <Progress value={order.progress} />
      {order.paymentStatus === "pending" && <div className="tracking-payment"><Clock3 aria-hidden="true" /><div><strong>{t.payment}</strong><span>{t.paymentBody}</span></div></div>}
      <ol className="tracking-timeline">
        {statusOrder.map((status, index) => (
          <li key={status} data-active={index <= currentIndex}><span>{index < currentIndex ? <Check aria-hidden="true" /> : index + 1}</span><strong>{statusText[locale][status]}</strong></li>
        ))}
      </ol>
      <div className="tracking-details">
        <Detail icon={MapPin} label={t.destination} value={order.destination} />
        <Detail icon={Truck} label={t.delivery} value={order.deliveryMethod} />
        <Detail icon={PackageCheck} label={t.route} value={routeLabel} />
        <Detail icon={CircleDollarSign} label={t.total} value={new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: order.currency }).format(order.amountCents / 100)} />
      </div>
      <div className="tracking-dates"><span>{t.placed}: {formatDate(order.createdAt, locale)}</span><span>{t.updated}: {formatDate(order.updatedAt, locale)}</span></div>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return <div><Icon aria-hidden="true" /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
