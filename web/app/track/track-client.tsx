"use client";

import { useActionState } from "react";
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  Clock3,
  Globe2,
  PackageCheck,
  Route,
  Search,
  Truck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { OrderStatus } from "@shared/ops-types";
import type { StoreLocale } from "@shared/catalog";
import { useStoreLocale } from "@/hooks/use-storefront";
import { lookupOrderAction } from "./actions";
import { initialTrackState, type TrackActionState } from "./action-state";

type Locale = StoreLocale;

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
    paymentBody: "Nothing was charged. This unpaid request does not reserve stock or arrange dispatch. Availability must be checked again before payment.",
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
    language: "Language",
    notFound: "We could not match that request number and email. Check both and try again.",
    error: "Tracking is temporarily unavailable, or the request number/email is invalid. Check the details and try again.",
    empty: "Your request status will appear here",
    emptyBody: "Enter the number and email used when saving the request.",
    standard: "Standard estimate", express: "Express estimate", priority: "Priority estimate",
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
    paymentBody: "目前未产生扣款。未付款需求不锁定库存，也不安排发货；未来付款前须重新确认可售情况。",
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
    language: "语言",
    notFound: "未找到与订单需求号及邮箱匹配的记录，请检查两项信息后重试。",
    error: "查询暂时不可用，或订单需求号与邮箱格式有误，请核对后重试。",
    empty: "订单需求状态会显示在这里",
    emptyBody: "请输入保存需求时的订单号与邮箱。",
    standard: "标准配送估算", express: "快捷配送估算", priority: "优先配送估算",
  },
  es: {
    title: "Consulta una solicitud.", body: "Usa el número y el correo de la solicitud guardada.",
    order: "Número de solicitud", email: "Correo electrónico", submit: "Buscar solicitud", searching: "Buscando…", back: "Volver a la tienda",
    payment: "Pago pendiente", paymentBody: "No se cobró nada. Esta solicitud no reserva existencias ni programa el envío. La disponibilidad debe revisarse antes de pagar.",
    destination: "Destino", delivery: "Envío", route: "Ruta prevista", total: "Importe de la solicitud", placed: "Guardada", updated: "Última actualización",
    marketplace: "Envío del vendedor", self: "Preparación propia", supplier: "Proveedor", split: "Varias rutas",
    language: "Idioma", notFound: "No encontramos esa combinación de número y correo. Revisa ambos y reintenta.",
    error: "La consulta no está disponible o los datos son inválidos. Revisa el número y el correo y reintenta.",
    empty: "Aquí aparecerá el estado de tu solicitud", emptyBody: "Introduce el número y el correo usados al guardar.",
    standard: "Estimación estándar", express: "Estimación exprés", priority: "Estimación prioritaria",
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
  es: { payment_pending: "Pago pendiente", purchase: "Abastecimiento", packing: "Preparación", handoff: "Entrega al transportista", transit: "En tránsito internacional", delivered: "Entregado" },
};

export function TrackClient({ initialOrderNumber }: { initialOrderNumber: string }) {
  const [state, action, pending] = useActionState(lookupOrderAction, initialTrackState);
  const [locale, setLocale] = useStoreLocale();
  const t = text[locale];

  return (
    <main className="track-shell">
      <header className="track-header">
        <a className="brand checkout-brand" href="/" aria-label="MIOVA 妙物 home"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a>
        <label className="track-language"><Globe2 aria-hidden="true" /><span className="sr-only">{t.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t.language}><option value="en">EN</option><option value="zh">简中</option><option value="es">ES</option></select></label>
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
          {state.kind !== "idle" && state.kind !== "found" && <div className="track-message" role="alert">{state.kind === "not_found" ? t.notFound : t.error}</div>}
        </section>

        <section className="track-result" aria-live="polite">
          {state.order ? <OrderResult order={state.order} locale={locale} /> : <TrackEmpty locale={locale} />}
        </section>
      </div>
    </main>
  );
}

function TrackEmpty({ locale }: { locale: Locale }) {
  return <div className="track-empty"><Route aria-hidden="true" /><strong>{text[locale].empty}</strong><span>{text[locale].emptyBody}</span></div>;
}

function OrderResult({ order, locale }: { order: NonNullable<TrackActionState["order"]>; locale: Locale }) {
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
        <Detail icon={Truck} label={t.delivery} value={order.deliveryMethod === "standard" || order.deliveryMethod === "express" || order.deliveryMethod === "priority" ? t[order.deliveryMethod] : order.deliveryMethod} />
        <Detail icon={PackageCheck} label={t.route} value={routeLabel} />
        <Detail icon={CircleDollarSign} label={t.total} value={new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale === "es" ? "es-ES" : "en-US", { style: "currency", currency: order.currency }).format(order.amountCents / 100)} />
      </div>
      <div className="tracking-dates"><span>{t.placed}: {formatDate(order.createdAt, locale)}</span><span>{t.updated}: {formatDate(order.updatedAt, locale)}</span></div>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Truck; label: string; value: string }) {
  return <div><Icon aria-hidden="true" /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "es" ? "es-ES" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
