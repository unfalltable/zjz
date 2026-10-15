"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { OpsProduct } from "@shared/ops-types";
import { variantLabel } from "@shared/variants";
import { saveVariantAction } from "./variant-actions";
import { initialOpsActionState } from "./action-state";
import { ProductImages } from "./product-images";

export function VariantManager({ rootSku, rootVersion, editable, locale }: { rootSku: string; rootVersion?: number; editable: boolean; locale: "zh" | "en" }) {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ requestKey: string; variants: OpsProduct[] | null; error: string }>({
    requestKey: "", variants: null, error: "",
  });
  const zh = locale === "zh";
  const requestKey = JSON.stringify([rootSku, rootVersion, revision, editable]);
  useEffect(() => {
    if (!editable) return;
    const controller = new AbortController();
    fetch(`/api/admin/variants?sku=${encodeURIComponent(rootSku)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async response => {
        const payload: unknown = await response.json();
        const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
        if (!response.ok || value?.ok !== true || !Array.isArray(value.variants)) {
          throw new Error(typeof value?.message === "string" ? value.message : "Could not load variants.");
        }
        return value.variants as OpsProduct[];
      })
      .then(value => {
        if (!controller.signal.aborted) setLoaded({ requestKey, variants: value, error: "" });
      }).catch(reason => {
        if (!controller.signal.aborted) setLoaded({
          requestKey, variants: null, error: reason instanceof Error ? reason.message : "Could not load variants.",
        });
      });
    return () => controller.abort();
  }, [rootSku, requestKey, editable]);
  const variants = loaded.requestKey === requestKey ? loaded.variants : null;
  const error = loaded.requestKey === requestKey ? loaded.error : "";
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const root = variants?.find(product => !product.isVariant);
  return <section className="product-variants" aria-label={zh ? `规格管理 ${rootSku}` : `Variants ${rootSku}`}>
    <h3>{zh ? "多规格 SKU" : "Product variants"}</h3>
    <p className="ops-field-note">{zh ? "先定义主 SKU 的规格，例如颜色＝蓝色、尺寸＝M，再创建其他组合。每个 SKU 独立定价、入库、计重和发货；新增规格默认下架且零库存。" : "Define dimensions on the main SKU first, such as Color = Blue, Size = M. Each combination has its own price, stock, weight and fulfillment. New variants are paused with zero stock."}</p>
    {error && <p role="alert">{error}<button type="button" className="admin-button" onClick={refresh}>{zh ? "重试" : "Retry"}</button></p>}
    {editable && !variants && !error && <p role="status">{zh ? "正在读取规格…" : "Loading variants…"}</p>}
    {root && <><div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>SKU</th><th>{zh ? "规格" : "Combination"}</th><th>{zh ? "售价 / 可用库存" : "Price / available stock"}</th><th>{zh ? "状态" : "Status"}</th></tr></thead><tbody>{variants!.map(product => <tr key={product.sku}><td>{product.sku}{!product.isVariant && <small>{zh ? "主 SKU" : "Main SKU"}</small>}</td><td>{variantLabel(product.variantAttributes) || (zh ? "尚未定义" : "Not defined")}</td><td>US${((product.priceCents ?? 0) / 100).toFixed(2)} / {product.inventory ?? 0}</td><td>{product.status === "active" ? (zh ? "上架" : "Active") : (zh ? "下架" : "Paused")}</td></tr>)}</tbody></table></div>
      {variants!.map(product => <details key={`${product.sku}-${product.version}`} className="admin-operation"><summary>{zh ? "编辑规格" : "Edit variant"} · {product.sku}</summary><VariantForm root={root} product={product} editable={editable} locale={locale} onSaved={refresh} /></details>)}
      {Object.keys(root.variantAttributes ?? {}).length > 0 ? <details className="admin-operation" key={`new-${root.version}`}><summary>{zh ? "新增规格 SKU" : "Add a variant SKU"}</summary><VariantForm root={root} editable={editable} locale={locale} onSaved={refresh} /></details> : <p className="admin-feedback">{zh ? "先在上方编辑主 SKU，填写规格名称和值，再添加其他组合。" : "Edit the main SKU above and define its dimensions before adding combinations."}</p>}
    </>}
  </section>;
}

function VariantForm({ root, product, editable, locale, onSaved }: { root: OpsProduct; product?: OpsProduct; editable: boolean; locale: "zh" | "en"; onSaved: () => void }) {
  const [state, action, pending] = useActionState(saveVariantAction, initialOpsActionState);
  const [uploading, setUploading] = useState(false);
  const zh = locale === "zh";
  const source = product ?? root;
  const entries = Object.entries(product?.variantAttributes ?? root.variantAttributes ?? {});
  useEffect(() => { if (state.kind === "success") { toast.success(state.message); onSaved(); } else if (state.kind === "error") toast.error(state.message); }, [state.eventId, state.kind, state.message, onSaved]);
  return <form action={action} className="admin-form" onSubmit={event => { if (uploading) event.preventDefault(); }}>
    <input name="mode" type="hidden" value={product ? "edit" : "create"} /><input name="targetSku" type="hidden" value={product?.sku ?? root.sku} /><input name="expectedVersion" type="hidden" value={product?.version ?? root.version ?? -1} />
    <fieldset disabled={!editable || pending}><legend>{product ? `${zh ? "规格资料" : "Variant settings"}: ${product.sku}` : (zh ? "新规格初始下架，库存为 0" : "New variant starts paused with zero stock")}</legend>
      {!product && <><label className="admin-field"><span>SKU</span><input name="sku" required maxLength={64} pattern="[A-Za-z0-9_.-]+" placeholder={`${root.sku}-BLUE-M`} /></label><label className="admin-field"><span>{zh ? "规格商品 URL 标识" : "Variant product URL ID"}</span><input name="storefrontId" required pattern="[a-z0-9][a-z0-9-]{0,63}" maxLength={64} placeholder={`${root.storefrontId ?? "product"}-blue-m`} /></label></>}
      {[0, 1, 2].map(index => <div className="variant-dimension wide" key={index}><label className="admin-field"><span>{zh ? `规格名称 ${index + 1}` : `Dimension ${index + 1}`}</span><input name={`attributeName${index + 1}`} defaultValue={entries[index]?.[0] ?? ""} required={index === 0 || Boolean(entries[index])} maxLength={40} readOnly={Boolean(root.variantAttributes && Object.keys(root.variantAttributes).length && (!product || product.isVariant))} placeholder={index === 0 ? (zh ? "颜色" : "Color") : index === 1 ? (zh ? "尺寸" : "Size") : (zh ? "可选" : "Optional")} /></label><label className="admin-field"><span>{zh ? `规格值 ${index + 1}` : `Value ${index + 1}`}</span><input name={`attributeValue${index + 1}`} defaultValue={product ? entries[index]?.[1] ?? "" : ""} required={index === 0 || Boolean(entries[index])} maxLength={60} placeholder={index === 0 ? (zh ? "蓝色" : "Blue") : index === 1 ? "M" : ""} /></label></div>)}
      <label className="admin-field"><span>{zh ? "售价（USD）" : "Price (USD)"}</span><input name="price" required inputMode="decimal" pattern="[0-9]{1,6}(\.[0-9]{1,2})?" defaultValue={((source.priceCents ?? 0) / 100).toFixed(2)} /></label><label className="admin-field"><span>{zh ? "划线价（可选）" : "Compare-at price (optional)"}</span><input name="compareAt" inputMode="decimal" pattern="[0-9]{1,6}(\.[0-9]{1,2})?" defaultValue={source.compareAtCents ? (source.compareAtCents / 100).toFixed(2) : ""} /></label>
      <label className="admin-field"><span>{zh ? "包装后重量（克）" : "Packed weight (g)"}</span><input name="shippingWeightGrams" type="number" required min={1} max={1000000} defaultValue={source.shippingWeightGrams ?? 500} /></label><label className="admin-field"><span>{zh ? "履约路线" : "Fulfillment route"}</span><select name="defaultFulfillment" defaultValue={source.defaultFulfillment}><option value="marketplace">{zh ? "平台卖家直发" : "Marketplace seller"}</option><option value="self">{zh ? "自包装" : "Self-packed"}</option><option value="supplier">{zh ? "供应商" : "Supplier"}</option></select></label>
      <label className="admin-field"><span>{zh ? "售卖状态" : "Sale status"}</span><select name="status" defaultValue={product?.status ?? "paused"}>{product && <option value="active">{zh ? "上架" : "Active"}</option>}<option value="paused">{zh ? "下架" : "Paused"}</option></select></label>
      <ProductImages image={source.image ?? root.image ?? ""} images={source.images ?? root.images ?? []} locale={locale} disabled={!editable || pending} onBusy={setUploading} />
      <p className="ops-field-note wide">{zh ? "此处不会修改库存，先到库存管理按实际数量入库。主商品下架后整组规格停止销售。" : "Stock is not edited here. Record physical receipts in Inventory. Pausing the main product stops the entire group."}</p>
      <button className="admin-button primary" type="submit" disabled={uploading}>{pending ? (zh ? "保存中…" : "Saving…") : uploading ? (zh ? "等待图片上传…" : "Waiting for images…") : (zh ? "保存规格" : "Save variant")}</button>
    </fieldset><p className={`admin-feedback ${state.kind}`} role={state.kind === "error" ? "alert" : "status"}>{state.message}</p>
  </form>;
}
