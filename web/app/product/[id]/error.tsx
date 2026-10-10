"use client";

import { Button } from "@/components/ui/button";
import { useStoreLocale } from "@/hooks/use-storefront";
import { commerceCopy } from "@/lib/commerce-copy";

export default function ProductError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale] = useStoreLocale();
  const t = commerceCopy(locale);
  return <main className="checkout-empty" role="alert"><h1>{t.unavailable}</h1><Button onClick={reset}>{t.retry}</Button><a className="checkout-primary-link" href="/">{t.backStore}</a></main>;
}
