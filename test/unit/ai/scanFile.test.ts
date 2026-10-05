import { describe, expect, it } from "vitest";
import { MAX_SOURCE_CHARS, aiStatusFor, buildScanPrompt, parseScanReply } from "../../../src/ai/scanFile";
import { buildViewData } from "../../../src/graph/neighbourhood";
import { DOCUMENT_SERVICE, serviceGraph } from "../helpers/fixtures";

const CONTROLLER = "src/api/controllers/DocumentController.ts";
const view = () => buildViewData(serviceGraph(), DOCUMENT_SERVICE);
const lineCounts = new Map([
  [DOCUMENT_SERVICE, 40],
  [CONTROLLER, 20],
]);
const reply = (value: unknown) => JSON.stringify(value);

describe("buildScanPrompt", () => {
  it("names the open file, lists related project files and numbers the source lines", () => {
    const prompt = buildScanPrompt("const a = 1;\nexport { a };", view());
    expect(prompt).toContain(`Open file: ${DOCUMENT_SERVICE}`);
    expect(prompt).toContain(`- ${CONTROLLER} (caller)`);
    expect(prompt).toContain("1| const a = 1;\n2| export { a };");
  });

  it("leaves packages and expected files out of the related files", () => {
    const prompt = buildScanPrompt("", view());
    expect(prompt).not.toMatch(/- package:/);
    expect(prompt).not.toMatch(/- expected:/);
  });

  it("cuts a long file and says where it was cut", () => {
    const longSource = Array.from({ length: 2000 }, (_, index) => `const value${index} = ${index};`).join("\n");
    const prompt = buildScanPrompt(longSource, view());
    expect(prompt).toMatch(/The file was cut after line \d+ of 2000\./);
    expect(prompt).not.toContain("const value1999 = 1999;");
    expect(prompt.length).toBeLessThan(MAX_SOURCE_CHARS + 12_000);
  });

  it("does not mention a cut when the whole file fits", () => {
    expect(buildScanPrompt("const a = 1;", view())).not.toContain("was cut");
  });
});

describe("parseScanReply", () => {
  it("reads the summary and the findings", () => {
    const result = parseScanReply(reply({ summary: " Saves documents. ", findings: [{ file: CONTROLLER, line: 4, text: "No error handling." }] }), lineCounts);
    expect(result).toEqual({ summary: "Saves documents.", findings: [{ file: CONTROLLER, line: 4, text: "No error handling." }] });
  });

  it("returns undefined when the reply is not JSON", () => {
    expect(parseScanReply("Sure! Here is the summary", lineCounts)).toBeUndefined();
  });

  it("returns undefined when the summary is missing or empty", () => {
    expect(parseScanReply(reply({ findings: [] }), lineCounts)).toBeUndefined();
    expect(parseScanReply(reply({ summary: "  ", findings: [] }), lineCounts)).toBeUndefined();
  });

  it("treats missing findings as none", () => {
    expect(parseScanReply(reply({ summary: "Saves documents." }), lineCounts)).toEqual({ summary: "Saves documents.", findings: [] });
  });

  it("drops findings that name a file outside the map, a line outside the file, or no text", () => {
    const result = parseScanReply(
      reply({
        summary: "Saves documents.",
        findings: [
          { file: "src/made/Up.ts", line: 1, text: "Unknown file." },
          { file: CONTROLLER, line: 21, text: "Past the last line." },
          { file: CONTROLLER, line: 0, text: "Before the first line." },
          { file: CONTROLLER, line: 2.5, text: "Not a whole line." },
          { file: CONTROLLER, line: 3, text: "" },
          { file: DOCUMENT_SERVICE, line: 40, text: "Kept." },
        ],
      }),
      lineCounts,
    );
    expect(result?.findings).toEqual([{ file: DOCUMENT_SERVICE, line: 40, text: "Kept." }]);
  });
});

describe("aiStatusFor", () => {
  const baseUrl = "http://localhost:11434";

  it("is not set up when no model is configured", () => {
    expect(aiStatusFor("", baseUrl, ["qwen2.5-coder:1.5b"])).toEqual({ ready: false, reason: "set wayfinder.ai.model" });
  });

  it("is not set up when Ollama does not answer", () => {
    expect(aiStatusFor("qwen2.5-coder:1.5b", baseUrl, null)).toEqual({ ready: false, reason: `Ollama is not running at ${baseUrl}` });
  });

  it("asks for a pull when the model is not installed", () => {
    expect(aiStatusFor("llama3.2", baseUrl, ["qwen2.5-coder:1.5b"])).toEqual({ ready: false, reason: "run ollama pull llama3.2" });
  });

  it("is ready when the model is installed, with or without the latest tag", () => {
    expect(aiStatusFor("qwen2.5-coder:1.5b", baseUrl, ["qwen2.5-coder:1.5b"])).toEqual({ ready: true, model: "qwen2.5-coder:1.5b" });
    expect(aiStatusFor("llama3.2", baseUrl, ["llama3.2:latest"])).toEqual({ ready: true, model: "llama3.2" });
  });
});
