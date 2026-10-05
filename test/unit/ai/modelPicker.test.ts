import { describe, expect, it } from "vitest";
import { CLOUD_CLIS } from "../../../src/ai/cloudCli";
import { modelPickerItems, sizeLabel } from "../../../src/ai/modelPicker";

const BASE_URL = "http://localhost:11434";

describe("modelPickerItems", () => {
  it("lists each installed model with its download size in GB", () => {
    const items = modelPickerItems(
      [
        { name: "qwen2.5-coder:1.5b", size: 986_061_892 },
        { name: "llama3.2:latest", size: 2_019_393_189 },
      ],
      BASE_URL,
      [],
    );
    expect(items).toEqual([
      { label: "qwen2.5-coder:1.5b", description: "1.0 GB", model: "qwen2.5-coder:1.5b" },
      { label: "llama3.2:latest", description: "2.0 GB", model: "llama3.2:latest" },
    ]);
  });

  it("says Ollama is not running at the base URL and offers the settings page", () => {
    expect(modelPickerItems(null, BASE_URL, [])).toEqual([
      { label: `Ollama is not running at ${BASE_URL}` },
      { label: "Open AI settings", opensSettings: true },
    ]);
  });

  it("lists installed cloud CLIs under a Cloud separator after the Ollama items", () => {
    expect(modelPickerItems([], BASE_URL, CLOUD_CLIS)).toEqual([
      { label: "No models installed. Run ollama pull qwen2.5-coder:3b" },
      { label: "Cloud", separator: true },
      { label: "Claude Code (cloud)", description: "sends code to Anthropic", model: "claude-code" },
      { label: "Codex (cloud)", description: "sends code to OpenAI", model: "codex" },
    ]);
  });

  it("tells the user to pull a model when none are installed", () => {
    expect(modelPickerItems([], BASE_URL, [])).toEqual([{ label: "No models installed. Run ollama pull qwen2.5-coder:3b" }]);
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
