import { config } from "../config/index.js";
import type { AssetStorage } from "./AssetStorage.js";
import { AzureBlobAssetStorage } from "./AzureBlobAssetStorage.js";
import { LocalAssetStorage } from "./LocalAssetStorage.js";

export function createAssetStorage(): AssetStorage {
  return config.storageProvider === "azure"
    ? new AzureBlobAssetStorage(config.azureStorageAccountUrl, config.azureStorageContainer)
    : new LocalAssetStorage(config.localAssetDir, config.publicAssetBaseUrl);
}
