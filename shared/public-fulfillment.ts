export type PublicFulfillment = {
  reviewStatus: "unreviewed" | "confirmed" | "cancelled";
  shipments: Array<{ carrierName: string; trackingNumber: string; trackingUrl: string | null;
    status: "shipped" | "transit" | "delivered"; createdAt: string; updatedAt: string; source: "manual" }>;
};
