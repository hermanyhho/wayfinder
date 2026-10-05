import { DocumentRepository } from "../db/repositories/DocumentRepository";
import { StorageClient } from "../integrations/storage/StorageClient";
import { PermissionPolicy } from "@/auth/PermissionPolicy";
import type { Document, NewDocument } from "../types/document.types";

export class DocumentService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: StorageClient,
    private readonly permissions: PermissionPolicy,
  ) {}

  async listForEmployee(actorId: string, employeeId: string): Promise<Document[]> {
    await this.permissions.assertCanRead(actorId, employeeId);
    return this.documents.findByEmployee(employeeId);
  }

  async upload(actorId: string, input: NewDocument, file: string): Promise<Document> {
    await this.permissions.assertCanWrite(actorId, input.employeeId);
    const fileKey = await this.storage.put(file);
    return this.documents.save({ ...input, fileKey });
  }
}
