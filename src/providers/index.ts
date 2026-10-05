export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ProviderConfig {
  name: string;
  model?: string;
  baseUrl?: string;
}

export interface ChatOptions {
  format?: "json";
  numCtx?: number;
  signal?: AbortSignal;
}

export class OllamaProvider {
  constructor(private config: ProviderConfig) {}

  private get baseUrl(): string {
    return this.config.baseUrl || "http://localhost:11434";
  }

  async chat(messages: Message[], systemPrompt?: string, options: ChatOptions = {}): Promise<string> {
    const msgs = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model || "llama3.2",
        messages: msgs,
        stream: false,
        ...(options.format && { format: options.format }),
        ...(options.numCtx && { options: { num_ctx: options.numCtx } }),
      }),
      signal: options.signal,
    });

    if (!res.ok) throw new Error(`Ollama error: ${await res.text()}`);
    const data = await res.json() as any;
    return data.message.content;
  }

  async listModels(signal?: AbortSignal): Promise<{ name: string; size: number }[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal });
    if (!res.ok) throw new Error(`Ollama error: ${await res.text()}`);
    const data = await res.json() as { models: { name: string; size: number }[] };
    return data.models.map((model) => ({ name: model.name, size: model.size }));
  }
}
