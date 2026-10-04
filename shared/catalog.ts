export type StoreLocale = "en" | "zh" | "es";
export type StoreCategory = "all" | "home" | "tech" | "wear";

export type StoreProduct = {
  id: string;
  sku: string;
  name: string;
  price: number;
  compareAt: number | null;
  rating: number;
  reviews: number;
  category: Exclude<StoreCategory, "all">;
  image: string;
  color: "blue" | "ice" | "coral";
  inventory: number;
  fulfillmentMode: "marketplace" | "self" | "supplier";
  badge: Record<StoreLocale, string>;
  description: Record<StoreLocale, string>;
  detail: Record<StoreLocale, string>;
};

export const CART_STORAGE_KEY = "miova_cart_v1";
export const FAVORITES_STORAGE_KEY = "miova_favorites_v1";
export const DESTINATION_STORAGE_KEY = "miova_destination_v1";

export const products: StoreProduct[] = [
  {
    id: "kumo",
    sku: "KUMO-01",
    name: "Cloud Cat Figure",
    price: 89,
    compareAt: 109,
    rating: 4.9,
    reviews: 128,
    category: "home",
    image: "/products/kumo.webp",
    color: "blue",
    inventory: 42,
    fulfillmentMode: "marketplace",
    badge: { en: "Limited", zh: "限量", es: "Limitado" },
    description: {
      en: "Soft-touch art object · NFC passport",
      zh: "亲肤材质艺术摆件 · NFC 证书",
      es: "Objeto artístico · pasaporte NFC",
    },
    detail: {
      en: "A small-run decorative figure with a soft-touch finish and a scannable authenticity passport.",
      zh: "小批量制作的艺术摆件，亲肤表面处理，并附带可扫描的真伪证书。",
      es: "Figura decorativa de serie corta, acabado suave y pasaporte de autenticidad escaneable.",
    },
  },
  {
    id: "nova",
    sku: "NOVA-02",
    name: "Nova Orb Speaker",
    price: 129,
    compareAt: null,
    rating: 4.8,
    reviews: 94,
    category: "tech",
    image: "/products/nova.webp",
    color: "ice",
    inventory: 18,
    fulfillmentMode: "supplier",
    badge: { en: "New", zh: "新品", es: "Nuevo" },
    description: {
      en: "Spatial audio · 12-hour battery",
      zh: "空间音效 · 12 小时续航",
      es: "Audio espacial · 12 horas",
    },
    detail: {
      en: "A compact wireless speaker with room-filling sound, tactile controls and up to 12 hours of play.",
      zh: "小巧无线音响，空间音效、实体按键，最长可播放 12 小时。",
      es: "Altavoz inalámbrico compacto, controles táctiles y hasta 12 horas de reproducción.",
    },
  },
  {
    id: "loop",
    sku: "LOOP-03",
    name: "Loop Mini Crossbody",
    price: 64,
    compareAt: 79,
    rating: 4.7,
    reviews: 211,
    category: "wear",
    image: "/products/loop.webp",
    color: "coral",
    inventory: 67,
    fulfillmentMode: "self",
    badge: { en: "Best seller", zh: "热卖", es: "Más vendido" },
    description: {
      en: "Recycled nylon · modular strap",
      zh: "再生尼龙 · 模块化背带",
      es: "Nailon reciclado · correa modular",
    },
    detail: {
      en: "A lightweight everyday crossbody made from recycled nylon with an adjustable modular strap.",
      zh: "轻量日用斜挎包，使用再生尼龙与可调节模块化背带。",
      es: "Bandolera ligera de nailon reciclado con correa modular ajustable.",
    },
  },
];

export const destinations = {
  US: { en: "United States", zh: "美国", es: "Estados Unidos" },
  CA: { en: "Canada", zh: "加拿大", es: "Canadá" },
  GB: { en: "United Kingdom", zh: "英国", es: "Reino Unido" },
  DE: { en: "Germany", zh: "德国", es: "Alemania" },
  AU: { en: "Australia", zh: "澳大利亚", es: "Australia" },
  FR: { en: "France", zh: "法国", es: "Francia" },
} as const;

export type DestinationCode = keyof typeof destinations;
