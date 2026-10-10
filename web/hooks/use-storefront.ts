"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoreLocale, StoreProduct } from "@shared/catalog";
import { fetchLiveCatalog, isStoreLocale, LOCALE_STORAGE_KEY, readBrowserValue, writeBrowserValue } from "@/lib/storefront";

export function useStoreLocale(initialLocale: StoreLocale = "en") {
  const [locale, updateLocale] = useState<StoreLocale>(initialLocale);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readBrowserValue(LOCALE_STORAGE_KEY);
      if (isStoreLocale(saved)) updateLocale(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { document.documentElement.lang = locale === "zh" ? "zh-CN" : locale; }, [locale]);
  const setLocale = useCallback((value: StoreLocale) => {
    updateLocale(value);
    writeBrowserValue(LOCALE_STORAGE_KEY, value);
  }, []);
  return [locale, setLocale] as const;
}

export function useLiveCatalog() {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => { setLoading(true); setError(false); setAttempt((value) => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchLiveCatalog(controller.signal).then((items) => {
      if (!controller.signal.aborted) setProducts(items);
    }).catch(() => {
      if (!controller.signal.aborted) { setProducts([]); setError(true); }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);
  return { products, loading, error, reload, updateProducts: setProducts };
}
