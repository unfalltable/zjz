"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ArrowLeft,
  Check,
  CreditCard,
  LockKeyhole,
  MapPin,
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
  products,
  type DestinationCode,
} from "@/lib/catalog";

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
  cardName: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
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
  cardName: "",
  cardNumber: "",
  expiry: "",
  cvc: "",
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
  const [cart, setCart] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<DestinationCode>("US");
  const [step, setStep] = useState<CheckoutStep>(1);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("standard");
  const [fields, setFields] = useState<CheckoutFields>(initialFields);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [marketing, setMarketing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedCart = window.localStorage.getItem(CART_STORAGE_KEY);
      const storedDestination = window.localStorage.getItem(DESTINATION_STORAGE_KEY) as DestinationCode | null;
      if (storedCart) setCart(JSON.parse(storedCart));
      if (storedDestination && storedDestination in destinations) setDestination(storedDestination);
    } finally {
      setHydrated(true);
    }
  }, []);

  const cartLines = useMemo(
    () => products.filter((product) => (cart[product.id] ?? 0) > 0),
    [cart]
  );
  const subtotal = useMemo(
    () => cartLines.reduce((sum, product) => sum + product.price * cart[product.id], 0),
    [cart, cartLines]
  );
  const selectedDelivery = deliveryOptions.find((option) => option.id === deliveryMethod) ?? deliveryOptions[0];
  const shipping = deliveryMethod === "standard" && subtotal >= 75 ? 0 : selectedDelivery.price;
  const total = subtotal + shipping;
  const progress = step === 1 ? 34 : step === 2 ? 67 : 100;

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
    if (["apartment", "region"].includes(name)) return undefined;
    if (!value) return "This field is required.";
    if (name === "email" && !/^\S+@\S+\.\S+$/.test(value)) return "Enter a valid email address.";
    if (name === "phone" && value.replace(/\D/g, "").length < 7) return "Enter a valid phone number.";
    if (name === "postal" && value.length < 3) return "Enter a valid postal code.";
    if (name === "cardNumber" && value.replace(/\D/g, "").length < 15) return "Enter a valid card number.";
    if (name === "expiry" && !/^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/.test(value)) return "Use MM / YY.";
    if (name === "cvc" && !/^\d{3,4}$/.test(value)) return "Enter the 3 or 4 digit security code.";
    return undefined;
  };

  const fieldsForStep: Record<CheckoutStep, FieldName[]> = {
    1: ["email", "firstName", "lastName", "address", "city", "postal", "phone"],
    2: [],
    3: ["cardName", "cardNumber", "expiry", "cvc"],
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
    if (!validateCurrentStep()) return;
    if (step < 3) {
      setStep((step + 1) as CheckoutStep);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const order = `MW-${Math.floor(10000 + Math.random() * 90000)}`;
    setOrderNumber(order);
    window.localStorage.removeItem(CART_STORAGE_KEY);
    window.localStorage.setItem("miova_last_order_v1", JSON.stringify({ order, total, createdAt: new Date().toISOString() }));
    setCart({});
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  if (!hydrated) {
    return <main className="checkout-loading" aria-busy="true"><span className="brand-mark" aria-hidden="true">M</span><p>Preparing secure checkout…</p></main>;
  }

  if (orderNumber) {
    return (
      <main className="checkout-success">
        <div className="checkout-success-card">
          <span className="success-icon" aria-hidden="true"><Check /></span>
          <p className="checkout-kicker">ORDER CONFIRMED</p>
          <h1>Thank you, {fields.firstName}.</h1>
          <p>Your order <strong>{orderNumber}</strong> is confirmed. A receipt and tracking updates will be sent to <strong>{fields.email}</strong>.</p>
          <div className="success-route"><MapPin aria-hidden="true" /><span>{fields.city}, {destinations[destination].en}</span><Truck aria-hidden="true" /><span>{selectedDelivery.timing}</span></div>
          <a className="checkout-primary-link" href="/">Continue shopping</a>
          <p className="prototype-note">Prototype confirmation — no payment was charged.</p>
        </div>
      </main>
    );
  }

  if (!cartLines.length) {
    return (
      <main className="checkout-empty">
        <ShoppingBag aria-hidden="true" />
        <h1>Your bag is empty.</h1>
        <p>Add something worth crossing borders for, then come back here.</p>
        <a className="checkout-primary-link" href="/#products">Browse products</a>
      </main>
    );
  }

  return (
    <main className="checkout-shell">
      <header className="checkout-header">
        <a className="brand checkout-brand" href="/" aria-label="MIOVA 妙物 home"><span className="brand-mark" aria-hidden="true">M</span><span>MIOVA 妙物</span></a>
        <div className="checkout-secure"><LockKeyhole aria-hidden="true" /><span>Secure checkout</span></div>
      </header>

      <div className="checkout-progress" aria-label={`Checkout step ${step} of 3`}>
        <div><span>0{step} / 03</span><strong>{step === 1 ? "Delivery details" : step === 2 ? "Shipping method" : "Payment"}</strong></div>
        <Progress value={progress} />
      </div>

      <div className="checkout-demo-note"><ShieldCheck aria-hidden="true" /><span>This is a fully interactive prototype checkout. Card details stay in your browser and no payment is charged.</span></div>

      <div className="checkout-layout">
        <section className="checkout-form-panel" aria-labelledby="checkout-title">
          <a href="/" className="checkout-back"><ArrowLeft aria-hidden="true" />Back to store</a>
          <div className="checkout-heading"><p>STEP {step}</p><h1 id="checkout-title">{step === 1 ? "Where should we send it?" : step === 2 ? "Choose your delivery speed." : "Complete your order."}</h1></div>

          {Object.keys(errors).length > 0 && (
            <div className="checkout-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
              <strong>Check the highlighted fields.</strong>
              <p>Your information is still here. Fix the details below and continue.</p>
            </div>
          )}

          {step === 1 && (
            <form className="checkout-form" onSubmit={(event) => { event.preventDefault(); moveForward(); }} noValidate>
              <fieldset><legend>Contact</legend>
                <CheckoutField label="Email address" name="email" type="email" value={fields.email} error={errors.email} autoComplete="email" onChange={updateField} onBlur={onBlur} />
                <label className="checkout-check"><Checkbox checked={marketing} onCheckedChange={(checked) => setMarketing(checked === true)} /><span>Send me new drops and member offers.</span></label>
              </fieldset>
              <fieldset><legend>Shipping address</legend>
                <div className="checkout-field-grid">
                  <CheckoutField label="First name" name="firstName" value={fields.firstName} error={errors.firstName} autoComplete="given-name" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label="Last name" name="lastName" value={fields.lastName} error={errors.lastName} autoComplete="family-name" onChange={updateField} onBlur={onBlur} />
                </div>
                <label className="checkout-field"><span>Country or region</span><select value={destination} onChange={(event) => { const value = event.target.value as DestinationCode; setDestination(value); window.localStorage.setItem(DESTINATION_STORAGE_KEY, value); }} autoComplete="country">{Object.entries(destinations).map(([code, names]) => <option value={code} key={code}>{names.en}</option>)}</select></label>
                <CheckoutField label="Street address" name="address" value={fields.address} error={errors.address} autoComplete="street-address" onChange={updateField} onBlur={onBlur} />
                <CheckoutField label="Apartment, suite, etc. (optional)" name="apartment" value={fields.apartment} autoComplete="address-line2" onChange={updateField} onBlur={onBlur} />
                <div className="checkout-field-grid three">
                  <CheckoutField label="City" name="city" value={fields.city} error={errors.city} autoComplete="address-level2" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label="State / region" name="region" value={fields.region} autoComplete="address-level1" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label="Postal code" name="postal" value={fields.postal} error={errors.postal} autoComplete="postal-code" onChange={updateField} onBlur={onBlur} />
                </div>
                <CheckoutField label="Phone" name="phone" type="tel" value={fields.phone} error={errors.phone} autoComplete="tel" onChange={updateField} onBlur={onBlur} />
              </fieldset>
              <Button type="submit" className="checkout-next">Continue to shipping</Button>
            </form>
          )}

          {step === 2 && (
            <div className="checkout-form">
              <RadioGroup value={deliveryMethod} onValueChange={(value) => setDeliveryMethod(value as DeliveryMethod)} className="delivery-options" aria-label="Delivery method">
                {deliveryOptions.map((option) => { const Icon = option.icon; const isFree = option.id === "standard" && subtotal >= 75; return (
                  <label className="delivery-option" data-selected={deliveryMethod === option.id} key={option.id}>
                    <RadioGroupItem value={option.id} /><Icon aria-hidden="true" /><span><strong>{option.title}</strong><small>{option.timing} · fully tracked</small></span><b>{isFree ? "FREE" : `$${option.price.toFixed(2)}`}</b>
                  </label>
                ); })}
              </RadioGroup>
              <div className="checkout-inline-actions"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button className="checkout-next" onClick={moveForward}>Continue to payment</Button></div>
            </div>
          )}

          {step === 3 && (
            <form className="checkout-form" onSubmit={(event) => { event.preventDefault(); moveForward(); }} noValidate>
              <div className="payment-heading"><CreditCard aria-hidden="true" /><div><strong>Credit or debit card</strong><span>Encrypted checkout interface</span></div><div className="payment-marks"><span>VISA</span><span>MC</span><span>AMEX</span></div></div>
              <fieldset><legend>Card details</legend>
                <CheckoutField label="Name on card" name="cardName" value={fields.cardName} error={errors.cardName} autoComplete="cc-name" onChange={updateField} onBlur={onBlur} />
                <CheckoutField label="Card number" name="cardNumber" value={fields.cardNumber} error={errors.cardNumber} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" onChange={updateField} onBlur={onBlur} />
                <div className="checkout-field-grid">
                  <CheckoutField label="Expiry" name="expiry" value={fields.expiry} error={errors.expiry} inputMode="numeric" autoComplete="cc-exp" placeholder="MM / YY" onChange={updateField} onBlur={onBlur} />
                  <CheckoutField label="Security code" name="cvc" value={fields.cvc} error={errors.cvc} inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" onChange={updateField} onBlur={onBlur} />
                </div>
              </fieldset>
              <div className="checkout-inline-actions"><Button variant="outline" type="button" onClick={() => setStep(2)}>Back</Button><Button type="submit" className="checkout-next"><LockKeyhole aria-hidden="true" />Place order · ${total.toFixed(2)}</Button></div>
            </form>
          )}
        </section>

        <aside className="checkout-summary" aria-labelledby="summary-title">
          <div className="summary-heading"><h2 id="summary-title">Order summary</h2><a href="/">Edit bag</a></div>
          <div className="summary-lines">{cartLines.map((product) => <div className="summary-line" key={product.id}><div className={`summary-media store-product-${product.color}`}><Image src={product.image} alt="" width={160} height={160} /><span>{cart[product.id]}</span></div><div><strong>{product.name}</strong><small>{product.description.en}</small><span>{product.sku}</span></div><b>${(product.price * cart[product.id]).toFixed(2)}</b></div>)}</div>
          <dl className="summary-totals"><div><dt>Subtotal</dt><dd>${subtotal.toFixed(2)}</dd></div><div><dt>Shipping</dt><dd>{shipping === 0 ? "FREE" : `$${shipping.toFixed(2)}`}</dd></div><div><dt>Estimated duties</dt><dd>$0.00</dd></div><div className="summary-total"><dt>Total</dt><dd><small>USD</small>${total.toFixed(2)}</dd></div></dl>
          <div className="summary-trust"><div><ShieldCheck aria-hidden="true" /><span><strong>Buyer protection</strong><small>30-day returns on eligible items</small></span></div><div><LockKeyhole aria-hidden="true" /><span><strong>Secure checkout</strong><small>Card data is never stored in this prototype</small></span></div></div>
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
