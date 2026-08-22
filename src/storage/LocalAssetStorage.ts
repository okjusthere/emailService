import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetStorage, PutAssetInput, StoredAsset } from "./AssetStorage.js";

export class LocalAssetStorage implements AssetStorage {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string
  ) {}
  async put(input: PutAssetInput): Promise<StoredAsset> {
    if (input.blobName.includes("..") || path.isAbsolute(input.blobName))
      throw new Error("Unsafe blob name");
    const target = path.join(this.root, input.blobName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.buffer, { flag: "wx" });
    return {
      blobName: input.blobName,
      publicUrl: this.getPublicUrl(input.blobName),
      byteSize: input.buffer.byteLength,
    };
  }
  async delete(blobName: string): Promise<void> {
    if (blobName.includes("..") || path.isAbsolute(blobName)) throw new Error("Unsafe blob name");
    await unlink(path.join(this.root, blobName)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  getPublicUrl(blobName: string): string {
    return `${this.publicBaseUrl}/${blobName.split("/").map(encodeURIComponent).join("/")}`;
  }
  async checkReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }
}
