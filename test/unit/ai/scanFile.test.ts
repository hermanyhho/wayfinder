import { describe, expect, it } from "vitest";
import { BUILT_IN_RULES, MAX_RULES_CHARS, MAX_SOURCE_CHARS, aiStatusFor, buildScanPrompt, neighbourFiles, parseScanReply } from "../../../src/ai/scanFile";
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
    const prompt = buildScanPrompt("const a = 1;\nexport { a };", view()).prompt;
    expect(prompt).toContain(`Open file: ${DOCUMENT_SERVICE}`);
    expect(prompt).toContain(`- ${CONTROLLER} (caller)`);
    expect(prompt).toContain("1| const a = 1;\n2| export { a };");
  });

  it("leaves packages and expected files out of the related files", () => {
    const prompt = buildScanPrompt("", view()).prompt;
    expect(prompt).not.toMatch(/- package:/);
    expect(prompt).not.toMatch(/- expected:/);
  });

  it("cuts a long file after a whole line and says which line", () => {
    const longSource = Array.from({ length: 2000 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");
    const prompt = buildScanPrompt(longSource, view()).prompt;
    const lastShownLine = Number(prompt.match(new RegExp(`${DOCUMENT_SERVICE} was cut after line (\\d+) of 2000\\.`))?.[1]);
    expect(prompt).toContain(`${lastShownLine}| const value${lastShownLine} = ${lastShownLine};`);
    expect(prompt).not.toContain(`${lastShownLine + 1}| `);
    expect(prompt.length).toBeLessThan(MAX_SOURCE_CHARS + 2_000);
  });

  it("does not mention a cut when the whole file fits", () => {
    expect(buildScanPrompt("const a = 1;", view()).prompt).not.toContain("was cut");
  });

  it("sends the built-in rules, then the repo rules, then the user rules", () => {
    const repoRule = "Flag every function longer than 20 lines";
    const userRule = "Flag every TODO comment";
    const { prompt, rulesCut } = buildScanPrompt("", view(), { repoRules: repoRule, userRules: userRule });
    expect(prompt.indexOf(BUILT_IN_RULES)).toBeGreaterThan(-1);
    expect(prompt.indexOf(repoRule)).toBeGreaterThan(prompt.indexOf(BUILT_IN_RULES));
    expect(prompt.indexOf(userRule)).toBeGreaterThan(prompt.indexOf(repoRule));
    expect(rulesCut).toBe(false);
  });

  it("cuts long rules to the rules limit and keeps the built-in rules whole", () => {
    const longRules = "- Flag this.\n".repeat(MAX_RULES_CHARS);
    const withoutRules = buildScanPrompt("", view()).prompt;
    const { prompt, rulesCut } = buildScanPrompt("", view(), { repoRules: longRules, userRules: "Flag every TODO comment" });
    expect(rulesCut).toBe(true);
    expect(prompt).toContain(BUILT_IN_RULES);
    expect(prompt).not.toContain("Flag every TODO comment");
    expect(prompt.length).toBeLessThanOrEqual(withoutRules.length + MAX_RULES_CHARS + 1);
  });

  it("ignores rules that are only whitespace", () => {
    const { prompt, rulesCut } = buildScanPrompt("", view(), { repoRules: "  \n ", userRules: "\t" });
    expect(prompt).toBe(buildScanPrompt("", view()).prompt);
    expect(rulesCut).toBe(false);
  });

  it("does not report a cut when the rules are exactly at the limit", () => {
    const heading = "Rules from the developer's settings:\n";
    const userRules = "x".repeat(MAX_RULES_CHARS - heading.length);
    expect(buildScanPrompt("", view(), { userRules }).rulesCut).toBe(false);
    expect(buildScanPrompt("", view(), { userRules: userRules + "x" }).rulesCut).toBe(true);
  });

  it("gives neighbours nothing when the open file fills the source limit", () => {
    const openSource = Array.from({ length: 2000 }, (_, index) => `const open${index + 1} = ${index + 1};`).join("\n");
    const { prompt } = buildScanPrompt(openSource, view(), { neighbourSources: [{ file: "src/first.ts", source: "export const a = 1;" }] });
    expect(prompt).toMatch(new RegExp(`${DOCUMENT_SERVICE} was cut after line \\d+ of 2000\\.`));
    expect(prompt).not.toContain("Source of src/first.ts");
  });

  it("adds the source of neighbours after the open file and stays under the source limit", () => {
    const repository = "src/db/repositories/DocumentRepository.ts";
    const { prompt } = buildScanPrompt("const a = 1;", view(), { neighbourSources: [{ file: repository, source: "export class DocumentRepository {}" }] });
    expect(prompt).toContain(`Source of ${repository}, with line numbers:\n1| export class DocumentRepository {}`);
    expect(prompt.indexOf(repository + ", with")).toBeGreaterThan(prompt.indexOf("1| const a = 1;"));
  });

  it("cuts neighbours before the open file when the source limit is reached", () => {
    const lines = (count: number, name: string) => Array.from({ length: count }, (_, index) => `const ${name}${index + 1} = ${index + 1};`).join("\n");
    const openSource = lines(400, "open");
    const neighbourSources = ["first", "second", "third"].map((name) => ({ file: `src/${name}.ts`, source: lines(200, name) }));
    const withoutNeighbours = buildScanPrompt(openSource, view()).prompt;
    const { prompt } = buildScanPrompt(openSource, view(), { neighbourSources });
    expect(prompt).toContain("400| const open400 = 400;");
    expect(prompt).toContain("200| const first200 = 200;");
    expect(prompt).not.toContain(`${DOCUMENT_SERVICE} was cut`);
    expect(prompt).toMatch(/src\/second\.ts was cut after line \d+ of 200\./);
    expect(prompt).not.toContain("Source of src/third.ts");
    expect(prompt.length).toBeLessThan(withoutNeighbours.length + MAX_SOURCE_CHARS);
  });
});

describe("neighbourFiles", () => {
  it("lists direct imports first, then tests and callers, and leaves out packages and the second layer", () => {
    const files = neighbourFiles(view());
    expect(files.slice(0, 4)).toEqual([
      "src/db/repositories/DocumentRepository.ts",
      "src/integrations/storage/StorageClient.ts",
      "src/auth/PermissionPolicy.ts",
      "src/types/document.types.ts",
    ]);
    expect(files).toContain(CONTROLLER);
    expect(files).not.toContain("src/db/schema.ts");
    expect(files.some((file) => file.startsWith("package:"))).toBe(false);
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
    expect(aiStatusFor("", baseUrl, ["qwen2.5-coder:1.5b"])).toEqual({ ready: false, reason: "no model is set" });
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
