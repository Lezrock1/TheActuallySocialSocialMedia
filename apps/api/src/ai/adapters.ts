export interface AiProviderCredentials {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProvider {
  chat(messages: ChatMessage[]): Promise<string>;
}

// Covers OpenAI itself, and anything exposing an OpenAI-compatible
// /chat/completions endpoint: Ollama (local), OpenRouter, Groq, etc.
export class OpenAICompatibleAdapter implements AiProvider {
  constructor(private creds: AiProviderCredentials) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.creds.baseUrl.replace(/\/$/, "")}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.creds.apiKey
            ? { Authorization: `Bearer ${this.creds.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.creds.model,
          messages,
        }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not reach ${url} (${reason})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Provider returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Provider returned no content");
    }
    return content;
  }
}

export class AnthropicAdapter implements AiProvider {
  constructor(private creds: AiProviderCredentials) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.creds.baseUrl.replace(/\/$/, "")}/messages`;
    // Anthropic takes the system prompt as a separate top-level field, not
    // as part of the messages array.
    const systemMessage = messages.find((m) => m.role === "system");
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(this.creds.apiKey ? { "x-api-key": this.creds.apiKey } : {}),
        },
        body: JSON.stringify({
          model: this.creds.model,
          max_tokens: 1024,
          ...(systemMessage ? { system: systemMessage.content } : {}),
          messages: conversation,
        }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not reach ${url} (${reason})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Provider returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const body = (await res.json()) as { content?: { text?: string }[] };
    const content = body.content?.[0]?.text;
    if (!content) {
      throw new Error("Provider returned no content");
    }
    return content;
  }
}

export function createAdapter(
  type: string,
  creds: AiProviderCredentials
): AiProvider {
  switch (type) {
    case "openai_compatible":
      return new OpenAICompatibleAdapter(creds);
    case "anthropic":
      return new AnthropicAdapter(creds);
    default:
      throw new Error(`Unknown AI provider type: ${type}`);
  }
}
