export type InstalledModel = { name: string; size: number };
export type ModelPickerItem = { label: string; description?: string; model?: string; opensSettings?: true };

const BYTES_PER_GB = 1_000_000_000;

export const sizeLabel = (bytes: number) => `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;

export function modelPickerItems(installedModels: InstalledModel[] | null, baseUrl: string): ModelPickerItem[] {
  if (!installedModels) return [{ label: `Ollama is not running at ${baseUrl}` }, { label: "Open AI settings", opensSettings: true }];
  if (installedModels.length === 0) return [{ label: "No models installed. Run ollama pull qwen2.5-coder:3b" }];
  return installedModels.map((model) => ({ label: model.name, description: sizeLabel(model.size), model: model.name }));
}
