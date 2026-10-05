import { documentsTable } from "../schema";
import type { Document, NewDocument } from "../../types/document.types";

export class DocumentRepository {
  async findByEmployee(employeeId: string): Promise<Document[]> {
    return [{ id: documentsTable, employeeId, fileKey: "" }];
  }
  async save(input: NewDocument & { fileKey: string }): Promise<Document> {
    return { id: "1", ...input };
  }
}
