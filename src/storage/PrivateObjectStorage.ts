import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { config } from "../config/index.js";

export interface PrivateObjectStorage {
  put(name: string, value: Buffer, contentType: string): Promise<void>;
  open(name: string): Promise<Readable>;
  get(name: string): Promise<Buffer>;
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class LocalPrivateStorage implements PrivateObjectStorage {
  private readonly root = path.resolve(config.localAssetDir, "..", "private");
  private target(name: string): string {
    if (name.includes("..") || path.isAbsolute(name)) throw new Error("Unsafe private object name");
    return path.join(this.root, name);
  }
  async put(name: string, value: Buffer): Promise<void> {
    const target = this.target(name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  async open(name: string): Promise<Readable> {
    return createReadStream(this.target(name));
  }
  async get(name: string): Promise<Buffer> {
    return readStream(await this.open(name));
  }
}

class AzurePrivateStorage implements PrivateObjectStorage {
  private readonly container = new BlobServiceClient(
    config.azureStorageAccountUrl,
    new DefaultAzureCredential()
  ).getContainerClient(config.azurePrivateContainer);
  async put(name: string, value: Buffer, contentType: string): Promise<void> {
    await this.container.getBlockBlobClient(name).uploadData(value, {
      blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: "no-store" },
    });
  }
  async open(name: string): Promise<Readable> {
    const response = await this.container.getBlobClient(name).download();
    if (!response.readableStreamBody) throw new Error(`Private object ${name} has no body`);
    return response.readableStreamBody as Readable;
  }
  async get(name: string): Promise<Buffer> {
    return readStream(await this.open(name));
  }
}

let privateStorage: PrivateObjectStorage | undefined;
export function getPrivateObjectStorage(): PrivateObjectStorage {
  privateStorage ??=
    config.storageProvider === "azure" ? new AzurePrivateStorage() : new LocalPrivateStorage();
  return privateStorage;
}
