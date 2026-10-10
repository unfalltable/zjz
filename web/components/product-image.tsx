import NextImage, { type ImageProps } from "next/image";

/** Supplier-hosted HTTPS images load directly, never through an unrestricted server-side image proxy. */
export default function ProductImage(props: ImageProps) {
  return <NextImage {...props} unoptimized={typeof props.src === "string" && props.src.startsWith("https://")} />;
}
