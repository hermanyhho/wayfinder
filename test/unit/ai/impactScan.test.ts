import { describe, expect, it } from "vitest";
import { buildImpactPrompt, type ImpactSources } from "../../../src/ai/impactScan";
import { MAX_RULES_CHARS, MAX_SOURCE_CHARS } from "../../../src/ai/scanFile";
import type { BranchView } from "../../../src/shared/viewData";

const SERVICE = "src/services/DocumentService.ts";
const CONTROLLER = "src/api/controllers/DocumentController.ts";
const JOB = "src/jobs/SendReminderJob.ts";
const ROUTES = "src/api/routes.ts";
const SERVICE_TEST = "src/services/DocumentService.test.ts";

const branch: Extract<BranchView, { state: "changes" }> = {
  state: "changes",
  branch: "feature/reminders",
  base: "origin/main",
  changed: [{ path: SERVICE, change: "modified", linesAdded: 2, linesRemoved: 1 }],
  importsChanged: [
    { path: CONTROLLER, via: [SERVICE] },
    { path: JOB, via: [SERVICE] },
  ],
  oneStepFurther: [{ path: ROUTES, via: [CONTROLLER] }],
  untested: [],
  testsToRun: [{ test: SERVICE_TEST, covers: SERVICE }],
  otherFileCount: 0,
};

const SERVICE_DIFF = `diff --git a/${SERVICE} b/${SERVICE}
index 1111111..2222222 100644
--- a/${SERVICE}
+++ b/${SERVICE}
@@ -10,3 +10,4 @@ export class DocumentService {
   send() {
-    return this.mailer.send();
+    const sent = this.mailer.send();
+    return sent.id;
   }`;

const sourceOfLines = (lineCount: number, name: string) => Array.from({ length: lineCount }, (_, index) => `const ${name}${index + 1} = ${index + 1};`).join("\n");

const sourcesWith = (overrides: Partial<ImpactSources> = {}): ImpactSources => ({
  diff: SERVICE_DIFF,
  newFiles: [],
  dependents: [
    { file: CONTROLLER, source: "service.send();" },
    { file: JOB, source: "export function run() {}\nrun();" },
  ],
  ...overrides,
});

describe("when building the impact prompt for a branch", () => {
  it("should list the changed files, their importers, the files one step further and the tests to run by name", () => {
    const { prompt } = buildImpactPrompt(branch, sourcesWith());

    expect(prompt).toContain(`- ${SERVICE} (modified, +2 -1)`);
    expect(prompt).toContain(`- ${CONTROLLER} (imports ${SERVICE})`);
    expect(prompt).toContain(`Files one step further, names only:\n- ${ROUTES}`);
    expect(prompt).toContain(`Tests to run, names only:\n- ${SERVICE_TEST} (covers ${SERVICE})`);
  });

  it("should number each line of the new version in the diff and leave removed lines unnumbered", () => {
    const { prompt } = buildImpactPrompt(branch, sourcesWith());

    expect(prompt).toContain("10|    send() {\n-    return this.mailer.send();\n11| +    const sent = this.mailer.send();\n12| +    return sent.id;\n13|    }");
  });

  it("should send the source of the files that import a changed file, but not of the files one step further", () => {
    const { prompt } = buildImpactPrompt(branch, sourcesWith());

    expect(prompt).toContain(`Source of ${CONTROLLER}, with line numbers:\n1| service.send();`);
    expect(prompt).not.toContain(`Source of ${ROUTES}`);
  });

  it("should accept findings up to the last numbered line of each file it sent", () => {
    const { lineCountByFile } = buildImpactPrompt(branch, sourcesWith());

    expect(Object.fromEntries(lineCountByFile)).toEqual({ [SERVICE]: 13, [CONTROLLER]: 1, [JOB]: 2 });
  });

  it("should not mention a cut when everything fits", () => {
    const { prompt, cutFiles } = buildImpactPrompt(branch, sourcesWith());

    expect(cutFiles).toEqual([]);
    expect(prompt).not.toContain("left out to fit");
  });

  it("should send a new file that git does not track yet as numbered source", () => {
    const { prompt, lineCountByFile } = buildImpactPrompt(branch, sourcesWith({ diff: "", newFiles: [{ file: "src/services/AuditService.ts", source: "export {};" }] }));

    expect(prompt).toContain("New file src/services/AuditService.ts, with line numbers:\n1| export {};");
    expect(prompt).not.toContain("Diff of the changed files");
    expect(lineCountByFile.get("src/services/AuditService.ts")).toBe(1);
  });
});

describe("when the payload is larger than the size limit", () => {
  it("should keep the diff and cut the last dependents first, naming them in the prompt", () => {
    const longController = { file: CONTROLLER, source: sourceOfLines(1200, "controllerValue") };

    const { prompt, cutFiles } = buildImpactPrompt(branch, sourcesWith({ dependents: [longController, { file: JOB, source: "run();" }] }));

    expect(prompt).toContain("12| +    return sent.id;");
    expect(cutFiles).toEqual([CONTROLLER, JOB]);
    expect(prompt).toContain(`Cut or left out to fit: ${CONTROLLER}, ${JOB}.`);
    expect(prompt).not.toContain(`Source of ${JOB}`);
  });

  it("should only accept findings on the controller lines that were sent", () => {
    const longController = { file: CONTROLLER, source: sourceOfLines(1200, "controllerValue") };

    const { prompt, lineCountByFile } = buildImpactPrompt(branch, sourcesWith({ dependents: [longController] }));

    const lastSentLine = lineCountByFile.get(CONTROLLER)!;
    expect(prompt).toContain(`${lastSentLine}| const controllerValue${lastSentLine} = ${lastSentLine};`);
    expect(prompt).not.toContain(`${lastSentLine + 1}| const controllerValue`);
  });

  it("should cut the diff and send no dependents when the diff alone is too large", () => {
    const addedLines = Array.from({ length: 1500 }, (_, index) => `+const added${index + 1} = ${index + 1};`).join("\n");
    const longDiff = `diff --git a/${SERVICE} b/${SERVICE}\n--- a/${SERVICE}\n+++ b/${SERVICE}\n@@ -1,0 +1,1500 @@\n${addedLines}`;

    const { prompt, cutFiles } = buildImpactPrompt(branch, sourcesWith({ diff: longDiff }));

    expect(cutFiles).toEqual([SERVICE, CONTROLLER, JOB]);
    expect(prompt).not.toContain(`Source of ${CONTROLLER}`);
    expect(prompt.length).toBeLessThan(MAX_SOURCE_CHARS + 2_000);
  });
});

describe("when numbering the lines of a diff", () => {
  const diffOnly = (diff: string) => buildImpactPrompt(branch, sourcesWith({ diff, dependents: [] }));

  it("should number each file from its own hunks when the diff has several files", () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +5,2 @@\n+one\n two\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,2 @@\n+three\n four`;

    const { prompt, lineCountByFile } = diffOnly(diff);

    expect(prompt).toContain("5| +one\n6|  two\ndiff --git a/b.ts");
    expect(prompt).toContain("1| +three\n2|  four");
    expect(Object.fromEntries(lineCountByFile)).toEqual({ "a.ts": 6, "b.ts": 2 });
  });

  it("should restart the numbering at the next hunk of the same file", () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n+first\n@@ -40,1 +50,1 @@\n+second`;

    const { prompt } = diffOnly(diff);

    expect(prompt).toContain("1| +first\n@@ -40,1 +50,1 @@\n50| +second");
  });

  it("should leave a hunk that only deletes lines unnumbered and give it no accepted lines", () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -3,2 +2,0 @@\n-gone\n-also gone`;

    const { prompt, lineCountByFile } = diffOnly(diff);

    expect(prompt).toContain("-gone\n-also gone");
    expect(lineCountByFile.has("a.ts")).toBe(false);
  });

  it("should leave a deleted file unnumbered", () => {
    const diff = `diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b`;

    const { prompt, lineCountByFile } = diffOnly(diff);

    expect(prompt).toContain("-a\n-b");
    expect(lineCountByFile.size).toBe(0);
  });

  it("should take the file name from the new side for an added file", () => {
    const diff = `diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b`;

    const { lineCountByFile } = diffOnly(diff);

    expect(Object.fromEntries(lineCountByFile)).toEqual({ "new.ts": 2 });
  });

  it("should not read an added line that looks like a file header as a new file", () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n+++ b/other.ts\n keep`;

    const { prompt, lineCountByFile } = diffOnly(diff);

    expect(prompt).toContain("1| +++ b/other.ts\n2|  keep");
    expect(Object.fromEntries(lineCountByFile)).toEqual({ "a.ts": 2 });
  });

  it("should pass a diff without hunks, such as a binary file, through unnumbered", () => {
    const diff = `diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ`;

    const { prompt, lineCountByFile } = diffOnly(diff);

    expect(prompt).toContain("Binary files a/logo.png and b/logo.png differ");
    expect(lineCountByFile.size).toBe(0);
  });

  it("should not number the no-newline marker and should split CRLF lines", () => {
    const diff = `diff --git a/a.ts b/a.ts\r\n--- a/a.ts\r\n+++ b/a.ts\r\n@@ -1,1 +1,1 @@\r\n+x\r\n\\ No newline at end of file`;

    const { prompt } = diffOnly(diff);

    expect(prompt).toContain("1| +x\n\\ No newline at end of file");
  });

  it("should send no diff section when the diff is blank", () => {
    const { prompt } = diffOnly("  \n");

    expect(prompt).not.toContain("Diff of the changed files");
  });
});

describe("when the developer has AI rules", () => {
  const TEAM_RULE = "Flag every removed export";
  const USER_RULE = "Flag every changed return type";
  const promptWithRules = (repoRules: string, userRules: string) => buildImpactPrompt(branch, sourcesWith(), { repoRules, userRules });
  const promptWithoutRules = () => buildImpactPrompt(branch, sourcesWith()).prompt;

  it("should add the team rules, then the user's rules, before the diff", () => {
    const { prompt, rulesCut } = promptWithRules(TEAM_RULE, USER_RULE);

    expect(prompt.indexOf(TEAM_RULE)).toBeGreaterThan(prompt.indexOf("Rules for what to check:"));
    expect(prompt.indexOf(USER_RULE)).toBeGreaterThan(prompt.indexOf(TEAM_RULE));
    expect(prompt.indexOf("Diff of the changed files")).toBeGreaterThan(prompt.indexOf(USER_RULE));
    expect(rulesCut).toBe(false);
  });

  it("should cut the rules at the rules limit and report the cut", () => {
    const longTeamRules = "- Flag this.\n".repeat(MAX_RULES_CHARS);

    const { prompt, rulesCut } = promptWithRules(longTeamRules, USER_RULE);

    expect(rulesCut).toBe(true);
    expect(prompt).not.toContain(USER_RULE);
    expect(prompt.length).toBeLessThanOrEqual(promptWithoutRules().length + "Rules for what to check:\n".length + MAX_RULES_CHARS + 1);
  });

  it("should send no rules section when the rules are only whitespace", () => {
    const { prompt, rulesCut } = promptWithRules("  \n ", "\t");

    expect(prompt).toBe(promptWithoutRules());
    expect(rulesCut).toBe(false);
  });
});
