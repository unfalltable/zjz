"use client";

import Image from "@/components/product-image";
import { useEffect, useMemo, useRef, useState, useTransition, type ComponentProps } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Globe2,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CART_STORAGE_KEY,
  DESTINATION_STORAGE_KEY,
  destinations,
  type DestinationCode,
  type StoreLocale,
} from "@shared/catalog";
import { useLiveCatalog, useStoreLocale } from "@/hooks/use-storefront";
import { commerceCopy } from "@/lib/commerce-copy";
import { clearCheckoutRetry, fetchLiveCatalog, markCheckoutAttempted, parseShoppingBag, readBrowserValue, retryKeyFor, scrollWithoutMotion, shoppingBagNeedsReview, writeBrowserValue } from "@/lib/storefront";
import { createPendingOrderAction, type CreateOrderResult } from "./actions";

type CheckoutStep = 1 | 2 | 3;
type DeliveryMethod = "standard" | "express" | "priority";
type CheckoutFields = {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  apartment: string;
  city: string;
  region: string;
  postal: string;
  phone: string;
};
type FieldName = keyof CheckoutFields;

const initialFields: CheckoutFields = {
  email: "",
  firstName: "",
  lastName: "",
  address: "",
  apartment: "",
  city: "",
  region: "",
  postal: "",
  phone: "",
};

const deliveryOptions: Array<{
  id: DeliveryMethod;
  title: string;
  timing: string;
  price: number;
  icon: typeof Truck;
}> = [
  { id: "standard", title: "Standard tracked", timing: "6–10 business days", price: 8.9, icon: Truck },
  { id: "express", title: "Express", timing: "3–5 business days", price: 18.9, icon: PackageCheck },
  { id: "priority", title: "Priority", timing: "2–3 business days", price: 32, icon: ShieldCheck },
];

export default function CheckoutPage() {
  const [locale, setLocale] = useStoreLocale();
  const t = commerceCopy(locale);
  const { products, loading: catalogLoading, error: catalogError, reload: reloadCatalog, updateProducts } = useLiveCatalog();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<DestinationCode>("US");
  const [step, setStep] = useState<CheckoutStep>(1);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("standard");
  const [fields, setFields] = useState<CheckoutFields>(initialFields);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [marketing, setMarketing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState("");
  const [bagRecovered, setBagRecovered] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [savedTotalCents, setSavedTotalCents] = useState(0);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [isSubmitting, startSubmit] = useTransition();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  // Contact/address data exists only in this page's memory, never in persisted retry metadata.
  const lastAttemptRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
    const restored = parseShoppingBag(readBrowserValue(CART_STORAGE_KEY));
    const storedDestination = readBrowserValue(DESTINATION_STORAGE_KEY) as DestinationCode | null;
    setCart(restored.bag);
    setBagRecovered(restored.recovered);
    if (storedDestination && storedDestination in destinations) setDestination(storedDestination);
    setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const cartLines = useMemo(
    () => products.filter((product) => (cart[product.id] ?? 0) > 0),
    [cart, products]
  );
  const subtotal = useMemo(
    () => cartLines.reduce((sum, product) => sum + (product.priceCents ?? Math.round(product.price * 100)) * cart[product.id], 0) / 100,
    [cart, cartLines]
  );
  const selectedDelivery = deliveryOptions.find((option) => option.id === deliveryMethod) ?? deliveryOptions[0];
  const shipping = deliveryMethod === "standard" && subtotal >= 75 ? 0 : selectedDelivery.price;
  const total = subtotal + shipping;
  const progress = step === 1 ? 34 : step === 2 ? 67 : 100;
  const invalidBag = shoppingBagNeedsReview(cart, products);

  const updateField = (name: FieldName, value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const validateField = (name: FieldName): string | undefined => {
    const value = fields[name].trim();
    const maxLength = { email: 254, firstName: 80, lastName: 80, address: 180, apartment: 80, city: 100, region: 100, postal: 20, phone: 30 }[name];
    if (value.length > maxLength) return t.tooLong;
    if (["apartment", "region"].includes(name)) return undefined;
    if (!value) return t.required;
    if (name === "email" && !/^\S+@\S+\.\S+$/.test(value)) return t.invalidEmail;
    if (name === "phone" && value.replace(/\D/g, "").length < 7) return t.invalidPhone;
    if (name === "postal" && value.length < 3) return t.invalidPostal;
    if (name === "address" && value.length < 3) return t.invalidAddress;
    return undefined;
  };

  const fieldsForStep: Record<CheckoutStep, FieldName[]> = {
    1: ["email", "firstName", "lastName", "address", "city", "postal", "phone"],
    2: [],
    3: [],
  };

  const validateCurrentStep = () => {
    const nextErrors: Partial<Record<FieldName, string>> = {};
    fieldsForStep[step].forEach((name) => {
      const error = validateField(name);
      if (error) nextErrors[name] = error;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return false;
    }
    return true;
  };

  const moveForward = () => {
    if (needsConfirmation) { confirmPreviousSave(); return; }
    if (catalogLoading || catalogError || invalidBag || !cartLines.length) return;
    if (!validateCurrentStep()) return;
    if (step < 3) {
      setStep((step + 1) as CheckoutStep);
      scrollWithoutMotion();
      return;
    }
    submitPendingOrder();
  };

  const acceptReceipt = (result: Extract<CreateOrderResult, { ok: true }>) => {
    setOrderNumber(result.orderNumber);
    setSavedTotalCents(result.totalCents);
    const cleared = writeBrowserValue(CART_STORAGE_KEY, null);
    const saved = writeBrowserValue("miova_last_order_v1", JSON.stringify({ order: result.orderNumber, paymentStatus: result.paymentStatus, createdAt: new Date().toISOString() }));
    clearCheckoutRetry();
    lastAttemptRef.current = null;
    setNeedsConfirmation(false);
    setStorageUnavailable(!cleared || !saved);
    setCart({});
    scrollWithoutMotion();
  };

  const confirmPreviousSave = () => {
    if (submittingRef.current || !lastAttemptRef.current) return;
    submittingRef.current = true;
    startSubmit(async () => {
      try {
        // Recovery must not be blocked by a product becoming unavailable after the accepted request.
        const result = await createPendingOrderAction(lastAttemptRef.current);
        if (result.ok) acceptReceipt(result);
        else {
          setSubmissionError(t.saveError);
          if (result.status !== 503) setNeedsConfirmation(false);
          window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
        }
      } catch { setSubmissionError(t.unknownResult); }
      finally { submittingRef.current = false; }
    });
  };

  const submitPendingOrder = () => {
    if (needsConfirmation) { confirmPreviousSave(); return; }
    if (submittingRef.current || invalidBag || !cartLines.length) return;
    submittingRef.current = true;
    setSubmissionError("");
    startSubmit(async () => {
      let requestSent = false;
      try {
        const currentProducts = await fetchLiveCatalog();
        updateProducts(currentProducts);
        if (shoppingBagNeedsReview(cart, currentProducts)) {
          setSubmissionError(t.stockChanged);
          window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
          return;
        }
        const currentById = new Map(currentProducts.map((product) => [product.id, product]));
        if (cartLines.some((product) => currentById.get(product.id)?.price !== product.price)) {
          setSubmissionError(t.priceChanged);
          window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
          return;
        }
        const input = {
          ...Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, name === "email" ? value.trim().toLowerCase() : value.trim()])),
          destination, deliveryMethod, marketingOptIn: marketing, website: "",
          items: Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => ({ id, quantity })),
        };
        const idempotencyKey = await retryKeyFor(input);
        markCheckoutAttempted(idempotencyKey);
        lastAttemptRef.current = { ...input, idempotencyKey };
        requestSent = true;
        const result = await createPendingOrderAction(lastAttemptRef.current);
        if (!result.ok) {
          setNeedsConfirmation(result.status === 503);
          if (result.code === "idempotency_conflict") clearCheckoutRetry();
          setSubmissionError(/available|inventory|stock|quantity/i.test(result.message) ? t.stockChanged : t.saveError);
          window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
          return;
        }
        acceptReceipt(result);
      } catch {
        setNeedsConfirmation(requestSent);
        setSubmissionError(requestSent ? t.unknownResult : t.saveError);
        window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      } finally { submittingRef.current = false; }
    });
  };

  const onBlur = (name: FieldName) => {
    const error = validateField(name);
    setErrors((current) => {
      const next = { ...current };
      if (error) next[name] = error;
      else delete next[name];
      return next;
    });
  };

  // An unknown result must be resolved with the original request before editing or
  // submitting another intent. Recovery does not depend on current catalog state.
  if (needsConfirmation && !orderNumber) {
    return (
      <main className="checkout-empty">
        <Clock3 aria-hidden="true" />
        <h1>{t.unknownResult}</h1>
        <p>{t.confirmPreviousBody}</p>
        {submissionError && <div className="checkout-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}><p>{submissionError}</p></div>}
        <Button type="button" onClick={confirmPreviousSave} disabled={isSubmitting}>{isSubmitting ? t.saving : t.confirmPrevious}</Button>
      </main>
    );
  }

  if (!hydrated || catalogLoading) {
    return <main className="checkout-loading" aria-busy="true" role="status"><span className="brand-mark" aria-hidden="true">M</span><p>{t.preparing}</p></main>;
  }

  if (orderNumber) {
    return (
      <main className="checkout-success">
        <div className="checkout-success-card">
          <span className="success-icon" aria-hidden="true"><Check /></span>
          <p className="checkout-kicker">{t.saved}</p>
          <h1>{t.savedTitle}</h1>
          <p><strong>{orderNumber}</strong> · {t.savedBody}</p>
          <p>{t.estimate}: <strong>${(savedTotalCents / 100).toFixed(2)} USD</strong></p>
          <p>{t.noReservation}</p><p>{t.dutyNote}</p>
          {storageUnavailable && <p role="status">{t.storage}</p>}
          <div className="checkout-success-actions"><a className="checkout-primary-link" href={`/track?order=${encodeURIComponent(orderNumber)}`}>{t.track}</a><a className="checkout-secondary-link" href="/">{t.continueShopping}</a></div>
          <p className="prototype-note">{t.status}</p>
        </div>
      </main>
    );
  }

  if (catalogError) {
    return <main className="checkout-empty" role="alert"><h1>{t.unavailable}</h1><Button onClick={reloadCatalog}>{t.retry}</Button><a href="/">{t.backStore}</a></main>;
  }

  if (!Object.keys(cart).length) {
    return (
      <main className="checkout-empty">
        <ShoppingBag aria-hidden="true" />
        <h1>{t.empty}</h1>
        <p>{t.emptyBody}</p>
        {bagRecovered && <p role="status">{t.recovered}</p>}
        <a className="checkout-primary-link" href="/#products">{t.browse}</a>
      </main>
    );
  }

  return (
    <main className="checkout-shell">
      <header className="checkout-header">
        <a className="brand checkout-brand" href="/" aria-label="MIOVA 妙物 home"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a>
        <label className="track-language"><Globe2 aria-hidden="true" /><span className="sr-only">{t.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as StoreLocale)} aria-label={t.language}><option value="en">English</option><option value="zh">中文</option><option value="es">Español</option></select></label>
      </header>

      <div className="checkout-progress" aria-label={`${t.step} ${step} / 3`}>
        <div><span>0{step} / 03</span><strong>{step === 1 ? t.details : step === 2 ? t.shippingMethod : t.review}</strong></div>
        <Progress value={progress} />
      </div>

      <div className="checkout-demo-note"><ShieldCheck aria-hidden="true" /><span>{t.paused}</span></div>
      {bagRecovered && <p className="store-bag-notice" role="status">{t.recovered}</p>}

      <div className="checkout-layout">
        <section className="checkout-form-panel" aria-labelledby="checkout-title">
          <a href="/" className="checkout-back"><ArrowLeft aria-hidden="true" />{t.backStore}</a>
          <div className="checkout-heading"><p>{t.step} {step}</p><h1 id="checkout-title">{step === 1 ? t.heading1 : step === 2 ? t.heading2 : t.heading3}</h1></div>

          {Object.keys(errors).length > 0 && (
            <div className="checkout-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
              <strong>{t.checkFields}</strong>
              <p>{t.fieldsRetained}</p>
              <ul>{Object.entries(errors).map(([name, error]) => <li key={name}><a href={`#${name}`}>{t[name as FieldName]}: {error}</a></li>)}</ul>
            </div>
          )}

          {(submissionError || invalidBag) && (
            <div className="checkout-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
              <strong>{t.failed}</strong>
              <p>{invalidBag ? t.stockChanged : submissionError}</p>
              {invalidBag && <a href="/#products">{t.editBag}</a>}
            </div>
          )}

          {step === 1 && (
            <form className="checkout-form" onSubmit={(event) => { event.preventDefault(); moveForward(); }} noValidate>
              <fieldset><legend>{t.contact}</legend>
                <CheckoutField label={t.email} name="email" type="email" value={fields.email} error={errors.email} autoComplete="email" onChange={updateField} onBlur={onBlur} />
                <label className="checkout-check"><Checkbox checked={marketing} onCheckedChange={(checked) => setMarketing(checked === true)} /><span>{t.marketing}</span></label>
              </fieldset>
              <fieldset><legend>{t.addressTitle}</legend>
                <div className="checkout-field-grid">
                  <CheckoutField label={t.firstName} name="firstName" value={fields.firstName} error={errors.firstName} autoComplete="given-name" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label={t.lastName} name="lastName" value={fields.lastName} error={errors.lastName} autoComplete="family-name" onChange={updateField} onBlur={onBlur} />
                </div>
                <label className="checkout-field"><span>{t.country}</span><select value={destination} onChange={(event) => { const value = event.target.value as DestinationCode; setDestination(value); writeBrowserValue(DESTINATION_STORAGE_KEY, value); }} autoComplete="country">{Object.entries(destinations).map(([code, names]) => <option value={code} key={code}>{names[locale]}</option>)}</select></label>
                <CheckoutField label={t.address} name="address" value={fields.address} error={errors.address} autoComplete="street-address" onChange={updateField} onBlur={onBlur} />
                <CheckoutField label={t.apartment} name="apartment" value={fields.apartment} error={errors.apartment} autoComplete="address-line2" onChange={updateField} onBlur={onBlur} />
                <div className="checkout-field-grid three">
                  <CheckoutField label={t.city} name="city" value={fields.city} error={errors.city} autoComplete="address-level2" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label={t.region} name="region" value={fields.region} error={errors.region} autoComplete="address-level1" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label={t.postal} name="postal" value={fields.postal} error={errors.postal} autoComplete="postal-code" onChange={updateField} onBlur={onBlur} />
                </div>
                <CheckoutField label={t.phone} name="phone" type="tel" value={fields.phone} error={errors.phone} autoComplete="tel" onChange={updateField} onBlur={onBlur} />
              </fieldset>
              <Button type="submit" className="checkout-next" disabled={invalidBag || isSubmitting}>{t.continueShipping}</Button>
            </form>
          )}

          {step === 2 && (
            <div className="checkout-form">
              <RadioGroup value={deliveryMethod} onValueChange={(value) => setDeliveryMethod(value as DeliveryMethod)} className="delivery-options" aria-label={t.shippingMethod}>
                {deliveryOptions.map((option) => { const Icon = option.icon; const isFree = option.id === "standard" && subtotal >= 75; return (
                  <label className="delivery-option" data-selected={deliveryMethod === option.id} key={option.id}>
                    <RadioGroupItem value={option.id} /><Icon aria-hidden="true" /><span><strong>{t[option.id]}</strong><small>{t[`${option.id}Timing`]}</small></span><b>{isFree ? t.free : `$${option.price.toFixed(2)}`}</b>
                  </label>
                ); })}
              </RadioGroup>
              <p>{t.timingNote}</p>
              <div className="checkout-inline-actions"><Button variant="outline" onClick={() => setStep(1)}>{t.back}</Button><Button className="checkout-next" onClick={moveForward} disabled={invalidBag}>{t.reviewButton}</Button></div>
            </div>
          )}

          {step === 3 && (
            <form className="checkout-form" onSubmit={(event) => { event.preventDefault(); moveForward(); }} noValidate>
              <div className="payment-heading payment-paused"><Clock3 aria-hidden="true" /><div><strong>{t.paymentPending}</strong></div><span className="payment-status-pill">{t.noCharge}</span></div>
              <div className="payment-paused-panel">
                <div><ShieldCheck aria-hidden="true" /><span><strong>{t.draft}</strong><small>{t.noCard}</small></span></div>
                <p>{t.noReservation}</p>
              </div>
              <div className="checkout-inline-actions"><Button variant="outline" type="button" onClick={() => setStep(2)} disabled={isSubmitting}>{t.back}</Button><Button type="submit" className="checkout-next" disabled={isSubmitting || invalidBag}><LockKeyhole aria-hidden="true" />{isSubmitting ? t.saving : `${t.save} · $${total.toFixed(2)}`}</Button></div>
            </form>
          )}
        </section>

        <aside className="checkout-summary" aria-labelledby="summary-title">
          <div className="summary-heading"><h2 id="summary-title">{t.summary}</h2><a href="/">{t.editBag}</a></div>
          <div className="summary-lines">{cartLines.map((product) => <div className="summary-line" key={product.id}><div className={`summary-media store-product-${product.color}`}><Image src={product.image} alt="" width={160} height={160} /><span>{cart[product.id]}</span></div><div><strong>{product.name}</strong><small>{product.description[locale]}</small><span>{product.sku}</span></div><b>${(product.price * cart[product.id]).toFixed(2)}</b></div>)}</div>
          <dl className="summary-totals"><div><dt>{t.subtotal}</dt><dd>${subtotal.toFixed(2)}</dd></div><div><dt>{t.shipping}</dt><dd>{shipping === 0 ? t.free : `$${shipping.toFixed(2)}`}</dd></div><div><dt>{t.duties}</dt><dd>{t.notCalculated}</dd></div><div className="summary-total"><dt>{t.estimate}</dt><dd><small>USD</small>${total.toFixed(2)}</dd></div></dl>
          <p>{t.dutyNote}</p>
          <div className="summary-trust"><div><LockKeyhole aria-hidden="true" /><span><strong>{t.noCharge}</strong><small>{t.noReservation}</small></span></div></div>
        </aside>
      </div>
    </main>
  );
}

function CheckoutField({
  label,
  name,
  value,
  error,
  onChange,
  onBlur,
  ...inputProps
}: {
  label: string;
  name: FieldName;
  value: string;
  error?: string;
  onChange: (name: FieldName, value: string) => void;
  onBlur: (name: FieldName) => void;
} & Omit<ComponentProps<typeof Input>, "name" | "value" | "onChange" | "onBlur">) {
  const errorId = `${name}-error`;
  return (
    <label className="checkout-field" htmlFor={name}>
      <span>{label}</span>
      <Input id={name} name={name} value={value} onChange={(event) => onChange(name, event.target.value)} onBlur={() => onBlur(name)} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...inputProps} />
      <small id={errorId} className="checkout-field-error" aria-live="polite">{error ?? " "}</small>
    </label>
  );
}
