import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiProviderConfigPublic, AiProviderType } from "@app/shared";
import { AI_PROVIDER_TYPES } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { card, input, btnPrimary, btnSecondary, btnDanger } from "../lib/ui.js";

async function fetchProviders(): Promise<AiProviderConfigPublic[]> {
  const res = await apiFetch<{ providers: AiProviderConfigPublic[] }>(
    "/ai/providers"
  );
  return res.providers;
}

export default function AiSettingsPage() {
  const queryClient = useQueryClient();
  const { data: providers = [] } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: fetchProviders,
  });

  const [label, setLabel] = useState("");
  const [type, setType] = useState<AiProviderType>("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await apiFetch("/ai/providers", {
      method: "POST",
      body: JSON.stringify({
        label,
        type,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
        isDefault,
      }),
    });
    setLabel("");
    setBaseUrl("");
    setModel("");
    setApiKey("");
    setIsDefault(false);
    await queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
  }

  async function onDelete(id: string) {
    await apiFetch(`/ai/providers/${id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
  }

  async function onSetDefault(id: string) {
    await apiFetch(`/ai/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isDefault: true }),
    });
    await queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<AiProviderType>("openai_compatible");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);

  function startEdit(p: AiProviderConfigPublic) {
    setEditingId(p.id);
    setEditType(p.type);
    setEditBaseUrl(p.baseUrl);
    setEditModel(p.model);
    setEditApiKey("");
    setClearApiKey(false);
  }

  async function saveEdit(id: string) {
    await apiFetch(`/ai/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        type: editType,
        baseUrl: editBaseUrl,
        model: editModel,
        apiKey: clearApiKey ? "" : editApiKey || undefined,
      }),
    });
    setEditingId(null);
    await queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader title="AI Tools" />
      <NavBar />
      <p className="mb-3 text-sm text-gray-600">
        OpenRouter Free is your default. OpenRouter selects an available free model; availability and limits are set by OpenRouter. You can add your own provider or API key below. Personal keys are encrypted at rest on this server.
      </p>
      <p className="mb-4 text-xs text-gray-500">
        Post content and prompts are sent to the provider you select. Add <code>OPENROUTER_API_KEY</code> on the server to provide a shared default key, or enter your own key here.
      </p>

      <div className="mb-6 flex flex-col gap-2">
        {providers.map((p) => (
          <div key={p.id} className={`${card} text-sm`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{p.label}</span>{" "}
                <span className="text-gray-500">({p.type}, {p.model})</span>
                <span className="ml-2 text-xs text-gray-500">
                  {p.apiKeySource === "personal"
                    ? "Personal key"
                    : p.apiKeySource === "platform"
                      ? "Shared server key"
                      : "API key required"}
                </span>
                {p.isDefault && (
                  <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs">Default</span>
                )}
              </div>
              <div className="flex gap-3 text-xs">
                {!p.isDefault && (
                  <button onClick={() => void onSetDefault(p.id)} className="underline">
                    Set as default
                  </button>
                )}
                <button onClick={() => startEdit(p)} className="underline">
                  Edit
                </button>
                <button onClick={() => void onDelete(p.id)} className={btnDanger}>
                  Delete
                </button>
              </div>
            </div>
            {editingId === p.id && (
              <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3">
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as AiProviderType)}
                  className={`${input} text-xs`}
                >
                  {AI_PROVIDER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === "openai_compatible" ? "OpenAI-compatible" : "Anthropic"}
                    </option>
                  ))}
                </select>
                <input
                  value={editBaseUrl}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  placeholder="Base URL"
                  className={`${input} text-xs`}
                />
                <input
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  placeholder="Model"
                  className={`${input} text-xs`}
                />
                <input
                  value={editApiKey}
                  onChange={(e) => {
                    setEditApiKey(e.target.value);
                    setClearApiKey(false);
                  }}
                  placeholder="New API key (leave blank to keep current key)"
                  type="password"
                  disabled={clearApiKey}
                  className={`${input} text-xs`}
                />
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(e) => setClearApiKey(e.target.checked)}
                  />
                  Remove the stored personal API key
                </label>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingId(null)} className={btnSecondary}>
                    Cancel
                  </button>
                  <button onClick={() => void saveEdit(p.id)} className={btnPrimary}>
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {providers.length === 0 && (
          <p className="text-sm text-gray-400">No providers configured yet.</p>
        )}
      </div>

      <form onSubmit={(e) => void onCreate(e)} className={`${card} flex flex-col gap-2`}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Provider name (e.g. My local model)"
          className={input}
          required
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AiProviderType)}
          className={input}
        >
          {AI_PROVIDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "openai_compatible" ? "OpenAI-compatible" : "Anthropic"}
            </option>
          ))}
        </select>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL (e.g. https://api.openai.com/v1)"
          className={input}
          required
        />
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model name (e.g. llama3, gpt-4o-mini, claude-3-5-sonnet)"
          className={input}
          required
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key (optional for local providers without authentication)"
          type="password"
          className={input}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Use as default
        </label>
        <button className="self-end rounded bg-black px-4 py-2 text-sm text-white">
          Add provider
        </button>
      </form>
    </div>
  );
}
