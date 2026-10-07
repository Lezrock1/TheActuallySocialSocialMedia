import { env } from "../env.js";
import { safePostJson, UnsafeUrlError } from "./safeHttp.js";

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

async function postToProvider(url: string, headers: Record<string, string>, payload: unknown): Promise<string> {
  let response;
  try {
    response = await safePostJson(url, JSON.stringify(payload), {
      headers,
      allowPrivate: env.allowPrivateAiUrls,
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    throw new Error("Could not reach the AI provider");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Provider returned status ${response.status}`);
  }
  return response.text;
}

// Covers OpenAI itself, and anything exposing an OpenAI-compatible
// /chat/completions endpoint: Ollama (local), OpenRouter, Groq, etc.
export class OpenAICompatibleAdapter implements AiProvider {
  constructor(private creds: AiProviderCredentials) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.creds.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const text = await postToProvider(
      url,
      this.creds.apiKey ? { Authorization: `Bearer ${this.creds.apiKey}` } : {},
      { model: this.creds.model, messages }
    );
    let body: { choices?: { message?: { content?: string } }[] };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Provider returned an invalid response");
    }
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

    const text = await postToProvider(
      url,
      {
        "anthropic-version": "2023-06-01",
        ...(this.creds.apiKey ? { "x-api-key": this.creds.apiKey } : {}),
      },
      {
        model: this.creds.model,
        max_tokens: 1024,
        ...(systemMessage ? { system: systemMessage.content } : {}),
        messages: conversation,
      }
    );
    let body: { content?: { text?: string }[] };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Provider returned an invalid response");
    }
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
