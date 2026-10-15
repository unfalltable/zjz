/** Fail-closed portable binding. Only the self-hosted Node build replaces this module. */
export type ManagedProductImage = {
  url: string; width: number; height: number; bytes: number; contentType: "image/webp";
};

export class MediaStorageError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

export async function saveProductImage(_ownerId: string, _bytes: Uint8Array, _contentType: string, _directory: string): Promise<ManagedProductImage> {
  throw new MediaStorageError("storage_unavailable", 503, "Product image upload is not configured for this deployment.");
}

export async function readProductImage(_ownerId: string, _filename: string, _directory: string): Promise<{ bytes: Uint8Array; etag: string } | null> {
  throw new MediaStorageError("storage_unavailable", 503, "Product image storage is not configured for this deployment.");
}
