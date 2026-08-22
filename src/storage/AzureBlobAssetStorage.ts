import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import type { AssetStorage, PutAssetInput, StoredAsset } from "./AssetStorage.js";

export class AzureBlobAssetStorage implements AssetStorage {
  private readonly service: BlobServiceClient;
  constructor(
    accountUrl: string,
    private readonly containerName: string
  ) {
    this.service = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  }
  async put(input: PutAssetInput): Promise<StoredAsset> {
    const blob = this.service
      .getContainerClient(this.containerName)
      .getBlockBlobClient(input.blobName);
    await blob.uploadData(input.buffer, {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
        blobCacheControl: input.cacheControl ?? "public,max-age=31536000,immutable",
        blobContentDisposition: "inline",
        blobContentEncoding: undefined,
      },
    });
    return { blobName: input.blobName, publicUrl: blob.url, byteSize: input.buffer.byteLength };
  }
  async delete(blobName: string): Promise<void> {
    await this.service
      .getContainerClient(this.containerName)
      .deleteBlob(blobName, { deleteSnapshots: "include" });
  }
  getPublicUrl(blobName: string): string {
    return this.service.getContainerClient(this.containerName).getBlobClient(blobName).url;
  }
  async checkReady(): Promise<void> {
    await this.service.getContainerClient(this.containerName).getProperties();
  }
}
