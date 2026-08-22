export interface PutAssetInput {
  blobName: string;
  buffer: Buffer;
  contentType: string;
  cacheControl?: string;
}
export interface StoredAsset {
  blobName: string;
  publicUrl: string;
  byteSize: number;
}

export interface AssetStorage {
  put(input: PutAssetInput): Promise<StoredAsset>;
  delete(blobName: string): Promise<void>;
  getPublicUrl(blobName: string): string;
  checkReady(): Promise<void>;
}
