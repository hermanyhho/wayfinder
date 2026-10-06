import { type CloudCli, cloudLabel } from "./cloudCli";

export type InstalledModel = { name: string; size: number };
export type ModelPickerItem = { label: string; description?: string; model?: string; opensSettings?: true; separator?: true };

const BYTES_PER_GB = 1_000_000_000;

export const sizeLabel = (bytes: number) => `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;

export function modelPickerItems(installedModels: InstalledModel[] | null, baseUrl: string, installedClis: CloudCli[], currentModel: string): ModelPickerItem[] {
  return [...ollamaItems(installedModels, baseUrl), ...cloudItems(installedClis), ...settingsItems(currentModel)];
}

function ollamaItems(installedModels: InstalledModel[] | null, baseUrl: string): ModelPickerItem[] {
  if (!installedModels) return [{ label: `Ollama is not running at ${baseUrl}` }];
  if (installedModels.length === 0) return [{ label: "No models installed. Run ollama pull qwen2.5-coder:3b" }];
  return installedModels.map((model) => ({ label: model.name, description: sizeLabel(model.size), model: model.name }));
}

function cloudItems(installedClis: CloudCli[]): ModelPickerItem[] {
  if (!installedClis.length) return [];
  return [{ label: "Cloud", separator: true }, ...installedClis.map((cli) => ({ label: cloudLabel(cli), description: `sends code to ${cli.company}`, model: cli.model }))];
}

function settingsItems(currentModel: string): ModelPickerItem[] {
  const turnOffAi: ModelPickerItem[] = currentModel ? [{ label: "Turn off AI", model: "" }] : [];
  return [{ label: "", separator: true }, ...turnOffAi, { label: "Open Wayfinder settings", opensSettings: true }];
}
