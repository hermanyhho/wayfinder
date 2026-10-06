import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLOUD_CLIS } from "../../../src/ai/cloudCli";
import { modelPickerItems, sizeLabel } from "../../../src/ai/modelPicker";
import { MAX_RULES_CHARS } from "../../../src/ai/scanFile";

const BASE_URL = "http://localhost:11434";
const NO_MODEL = "";
const SETTINGS_SEPARATOR = { label: "", separator: true };
const TURN_OFF_AI = { label: "Turn off AI", model: "" };
const OPEN_SETTINGS = { label: "Open Wayfinder settings", opensSettings: true };
const CLOUD_ITEMS = [
  { label: "Cloud", separator: true },
  { label: "Claude Code (cloud)", description: "sends code to Anthropic", model: "claude-code" },
  { label: "Codex (cloud)", description: "sends code to OpenAI", model: "codex" },
];
const NO_MODELS_INSTALLED = { label: "No models installed. Run ollama pull qwen2.5-coder:3b" };

describe("modelPickerItems", () => {
  it("lists each installed model with its download size in GB, then the settings item", () => {
    const items = modelPickerItems(
      [
        { name: "qwen2.5-coder:1.5b", size: 986_061_892 },
        { name: "llama3.2:latest", size: 2_019_393_189 },
      ],
      BASE_URL,
      [],
      NO_MODEL,
    );
    expect(items).toEqual([
      { label: "qwen2.5-coder:1.5b", description: "1.0 GB", model: "qwen2.5-coder:1.5b" },
      { label: "llama3.2:latest", description: "2.0 GB", model: "llama3.2:latest" },
      SETTINGS_SEPARATOR,
      OPEN_SETTINGS,
    ]);
  });

  it("offers to turn off AI before the settings item when a model is set", () => {
    const items = modelPickerItems([{ name: "qwen2.5-coder:1.5b", size: 986_061_892 }], BASE_URL, [], "qwen2.5-coder:1.5b");
    expect(items.slice(-3)).toEqual([SETTINGS_SEPARATOR, TURN_OFF_AI, OPEN_SETTINGS]);
  });

  it("says Ollama is not running at the base URL and offers the settings item once", () => {
    expect(modelPickerItems(null, BASE_URL, [], NO_MODEL)).toEqual([{ label: `Ollama is not running at ${BASE_URL}` }, SETTINGS_SEPARATOR, OPEN_SETTINGS]);
  });

  it("keeps cloud CLIs and turn off AI above the settings item when Ollama is not running", () => {
    expect(modelPickerItems(null, BASE_URL, CLOUD_CLIS, "codex")).toEqual([
      { label: `Ollama is not running at ${BASE_URL}` },
      ...CLOUD_ITEMS,
      SETTINGS_SEPARATOR,
      TURN_OFF_AI,
      OPEN_SETTINGS,
    ]);
  });

  it("lists installed cloud CLIs under a Cloud separator after the Ollama items", () => {
    expect(modelPickerItems([], BASE_URL, CLOUD_CLIS, NO_MODEL)).toEqual([NO_MODELS_INSTALLED, ...CLOUD_ITEMS, SETTINGS_SEPARATOR, OPEN_SETTINGS]);
  });

  it("tells the user to pull a model when none are installed", () => {
    expect(modelPickerItems([], BASE_URL, [], NO_MODEL)).toEqual([NO_MODELS_INSTALLED, SETTINGS_SEPARATOR, OPEN_SETTINGS]);
    expect(modelPickerItems([], BASE_URL, [], "qwen2.5-coder:1.5b")).toEqual([NO_MODELS_INSTALLED, SETTINGS_SEPARATOR, TURN_OFF_AI, OPEN_SETTINGS]);
  });
});

describe("wayfinder.ai.instructions setting", () => {
  it("states the same rules limit that scans apply", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8"));
    const description: string = manifest.contributes.configuration.properties["wayfinder.ai.instructions"].markdownDescription;
    expect(description).toContain(`cut at ${MAX_RULES_CHARS.toLocaleString("en-US")} characters`);
  });
});

describe("sizeLabel", () => {
  it("rounds to one decimal place in decimal gigabytes", () => {
    expect(sizeLabel(1_949_000_000)).toBe("1.9 GB");
    expect(sizeLabel(1_951_000_000)).toBe("2.0 GB");
  });

  it("shows 0.0 GB for an empty model and keeps GB for sizes over 10 GB", () => {
    expect(sizeLabel(0)).toBe("0.0 GB");
    expect(sizeLabel(42_520_000_000)).toBe("42.5 GB");
  });
});
