"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, X, ArrowLeft } from "lucide-react";
import { isProductImage } from "@shared/assets";

export function ProductImages({ image = "", images = [], locale, disabled, onBusy }: { image?: string; images?: string[]; locale: "zh" | "en"; disabled: boolean; onBusy?: (busy: boolean) => void }) {
  const zh = locale === "zh";
  const id = useId();
  const [primary, setPrimary] = useState(image);
  const [gallery, setGallery] = useState(() => [...new Set([image, ...images].filter(Boolean))].slice(0, 8));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = [...files];
    if (selected.length + gallery.length > 8 || selected.some(file => file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError(true); setMessage(zh ? "最多 8 张图片，每张不超过 10 MB，仅支持 JPEG、PNG、WebP。" : "Up to 8 images, 10 MB each. Use JPEG, PNG or WebP."); return;
    }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onBusy?.(true); setError(false);
    let first = primary;
    try {
      for (const [index, file] of selected.entries()) {
        setMessage(zh ? `正在上传 ${index + 1}/${selected.length}：${file.name}` : `Uploading ${index + 1}/${selected.length}: ${file.name}`);
        const data = new FormData(); data.set("file", file);
        const response = await fetch("/api/admin/media", { method: "POST", body: data, credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        const payload: unknown = await response.json().catch(() => null);
        const result = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
        const image = result?.image && typeof result.image === "object" ? result.image as Record<string, unknown> : null;
        const url = image?.url;
        if (!response.ok || result?.ok !== true || typeof url !== "string" || !url.startsWith("/media/") || !isProductImage(url)) {
          throw new Error(typeof result?.message === "string" ? result.message : (zh ? "图片未上传，请检查文件和服务器存储配置。" : "Upload failed. Check the file and server storage settings."));
        }
        setGallery(previous => [...new Set([...previous, url])].slice(0, 8));
        if (!first) { first = url; setPrimary(first); }
      }
      setMessage(zh ? "图片已上传。保存商品后才会更新商城展示。" : "Images uploaded. Save the product to update the storefront.");
    } catch (reason) {
      if (!controller.signal.aborted) { setError(true); setMessage(reason instanceof Error ? reason.message : "Upload failed."); }
    } finally { if (!controller.signal.aborted) { setBusy(false); onBusy?.(false); } }
  }
  function remove(url: string) { const next = gallery.filter(value => value !== url); setGallery(next); if (primary === url) setPrimary(next[0] ?? ""); }
  return <div className="product-media-editor">
    <label htmlFor={id}>{zh ? "商品图片" : "Product images"}</label>
    <p className="ops-field-note">{zh ? "上传实拍商品图，最多 8 张。服务器压缩并移除原始元数据；点击缩略图设为主图。" : "Upload up to 8 product photos. Images are compressed and metadata removed. Select a thumbnail to make it the cover."}</p>
    <div className="product-media-gallery">{gallery.map((url, index) => <div className="product-media-thumbnail" key={url}>
      <button type="button" disabled={disabled || busy} className={primary === url ? "selected" : ""} onClick={() => setPrimary(url)} aria-pressed={primary === url} aria-label={zh ? `设第 ${index + 1} 张为主图` : `Use image ${index + 1} as cover`}><img src={url} alt={zh ? `商品图 ${index + 1}` : `Product image ${index + 1}`} loading="lazy" /><span>{primary === url ? (zh ? "主图" : "Cover") : index + 1}</span></button>
      <button type="button" className="product-media-remove" disabled={disabled || busy} onClick={() => remove(url)} aria-label={zh ? `移除第 ${index + 1} 张图片` : `Remove image ${index + 1}`}><X size={16} aria-hidden="true" /></button>
      {index > 0 && <button type="button" className="product-media-reorder" disabled={disabled || busy} onClick={() => setGallery(previous => { const next = [...previous]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} aria-label={zh ? `将第 ${index + 1} 张图片前移` : `Move image ${index + 1} earlier`}><ArrowLeft size={16} aria-hidden="true" /></button>}
    </div>)}</div>
    <label className="product-media-upload" htmlFor={id}><ImagePlus aria-hidden="true" />{zh ? "选择图片上传" : "Choose images to upload"}<input id={id} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || busy || gallery.length >= 8} onChange={event => { void upload(event.target.files); event.target.value = ""; }} aria-describedby={`${id}-help`} /></label>
    <label>{zh ? "主图地址（也可填写 HTTPS 图片链接）" : "Cover URL (an HTTPS image link also works)"}<input name="image" value={primary} onChange={event => setPrimary(event.target.value)} onBlur={() => { if (primary && !isProductImage(primary)) { setError(true); setMessage(zh ? "请使用上传图片或有效的 HTTPS 商品图片链接。" : "Use an uploaded image or a valid HTTPS product image URL."); } else if (primary && !gallery.includes(primary) && gallery.length < 8) setGallery(previous => [...previous, primary]); }} required maxLength={2048} disabled={disabled || busy} /></label>
    <input type="hidden" name="images" value={JSON.stringify(gallery.filter(isProductImage))} />
    <p id={`${id}-help`} className={`ops-action-message ${error ? "error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{message}</p>
  </div>;
}
