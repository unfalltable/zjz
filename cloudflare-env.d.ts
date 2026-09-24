declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    STORE_OWNER_ID?: string;
    PAYMENTS_ENABLED?: string;
  }
}
