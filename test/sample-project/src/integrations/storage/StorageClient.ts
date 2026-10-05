import { bucket } from "../../config/storage.config";

export class StorageClient {
  async put(file: string) {
    return `${bucket}/${file}`;
  }
}
