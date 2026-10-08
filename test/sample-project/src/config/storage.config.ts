export const bucket = "documents-bucket";
export const MAX_UPLOAD_MB = 25;
const CHUNK_SIZE = 1024 * 1024;
export const chunkCountFor = (bytes: number) => Math.ceil(bytes / CHUNK_SIZE);
