import { expect, it } from "vitest";
import { parseGitLog } from "../../../src/workspace/gitFacts";

it("turns git log lines into facts", () => {
  const stdout = "3 weeks ago\tadd remindUnsigned for the reminder job\n4 months ago\tcheck permissions on upload\n";
  expect(parseGitLog(stdout)).toEqual([
    { label: "3 weeks ago", value: "add remindUnsigned for the reminder job" },
    { label: "4 months ago", value: "check permissions on upload" },
  ]);
});
