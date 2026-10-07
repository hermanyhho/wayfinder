import { describe, expect, it } from "vitest";
import { DocumentService } from "../DocumentService";
import { DocumentRepository } from "../../db/repositories/DocumentRepository";
import { StorageClient } from "../../integrations/storage/StorageClient";
import { PermissionPolicy } from "@/auth/PermissionPolicy";
import type { NewDocument } from "../../types/document.types";
import { buildDocument } from "../../../test/fixtures/documents.fixture";

const createService = () => new DocumentService(new DocumentRepository(), new StorageClient(), new PermissionPolicy());

describe("DocumentService against the real repository", () => {
  describe("when an employee uploads a document", () => {
    it("should save it with a storage key", async () => {
      const input: NewDocument = { employeeId: "e1" };

      const saved = await createService().upload("e1", input, "contract.pdf");

      expect(saved.fileKey).toBeTruthy();
    });
  });

  describe("when a manager lists an employee's documents", () => {
    it("should return the saved documents", async () => {
      const expected = buildDocument();

      const documents = await createService().listForEmployee("m1", expected.employeeId);

      expect(documents).toContainEqual(expected);
    });

    it.skip("should leave out deleted documents", () => {});
  });
});
