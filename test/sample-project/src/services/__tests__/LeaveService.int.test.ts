import { describe, expect, it } from "vitest";

describe("LeaveService through the HTTP API", () => {
  describe("when an employee requests leave", () => {
    it("should return 201 with the new request", async () => {
      const response = await fetch("http://localhost:3000/leave", { method: "POST" });

      expect(response.status).toBe(201);
    });
  });
});
