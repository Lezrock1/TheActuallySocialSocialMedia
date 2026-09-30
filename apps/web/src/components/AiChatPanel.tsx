import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiConversation,
  AiMode,
  AiProviderConfigPublic,
} from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";

async function fetchProviders(): Promise<AiProviderConfigPublic[]> {
  const res = await apiFetch<{ providers: AiProviderConfigPublic[] }>(
    "/ai/providers"
  );
  return res.providers;
}

const MODE_CONFIG: Record<
  AiMode,
  { label: string; colorClass: string; activeColorClass: string }
> = {
  factcheck: {
    label: "FactCheck",
    colorClass: "bg-blue-600 hover:bg-blue-700",
    activeColorClass: "bg-blue-600",
  },
  explain: {
    label: "Explain",
    colorClass: "bg-green-600 hover:bg-green-700",
    activeColorClass: "bg-green-600",
  },
  custom: {
    label: "Ask",
    colorClass: "bg-purple-600 hover:bg-purple-700",
    activeColorClass: "bg-purple-600",
  },
};

export default function AiChatPanel({ postId }: { postId: string }) {
  const queryClient = useQueryClient();
  const { data: providers = [] } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: fetchProviders,
  });

  const [activeMode, setActiveMode] = useState<AiMode | null>(null);
  const [providerId, setProviderId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [shareResult, setShareResult] = useState(false);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [followUpText, setFollowUpText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) return null;

  function openMode(mode: AiMode) {
    setActiveMode(mode);
    setConversation(null);
    setError(null);
    setCustomPrompt("");
    setShareResult(false);
    setProviderId(providers.find((p) => p.isDefault)?.id ?? providers[0].id);
  }

  async function startConversation() {
    if (!activeMode) return;
    if (activeMode === "custom" && !customPrompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ conversation: AiConversation }>(
        "/ai/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            postId,
            providerConfigId: providerId,
            mode: activeMode,
            customPrompt: activeMode === "custom" ? customPrompt : undefined,
            shared: activeMode === "factcheck" ? shareResult : undefined,
          }),
        }
      );
      setConversation(res.conversation);
      if (activeMode === "factcheck" && shareResult) {
        void queryClient.invalidateQueries({
          queryKey: ["factcheck-summary", postId],
        });
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Anfrage an den KI-Anbieter fehlgeschlagen"
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendFollowUp() {
    if (!conversation || !followUpText.trim()) return;
    setLoading(true);
    setError(null);
    const text = followUpText;
    setFollowUpText("");
    // optimistic: show the question immediately
    setConversation((c) =>
      c
        ? {
            ...c,
            messages: [
              ...c.messages,
              {
                id: `pending-${Date.now()}`,
                role: "user",
                content: text,
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : c
    );
    try {
      const res = await apiFetch<{ message: AiConversation["messages"][number] }>(
        `/ai/conversations/${conversation.id}/messages`,
        { method: "POST", body: JSON.stringify({ text }) }
      );
      setConversation((c) =>
        c ? { ...c, messages: [...c.messages, res.message] } : c
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Anfrage an den KI-Anbieter fehlgeschlagen"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        {(Object.keys(MODE_CONFIG) as AiMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => openMode(mode)}
            className={`rounded px-2 py-1 text-xs text-white ${
              activeMode === mode
                ? MODE_CONFIG[mode].activeColorClass
                : `${MODE_CONFIG[mode].colorClass} opacity-70`
            }`}
          >
            {MODE_CONFIG[mode].label}
          </button>
        ))}
      </div>

      {activeMode && (
        <div className="mt-2 rounded border p-2 text-xs">
          {!conversation && (
            <div className="flex flex-col gap-2">
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="rounded border px-1 py-0.5"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {activeMode === "custom" && (
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Was möchtest du zu diesem Post wissen?"
                  className="rounded border p-1"
                  rows={2}
                />
              )}
              {activeMode === "factcheck" && (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={shareResult}
                    onChange={(e) => setShareResult(e.target.checked)}
                  />
                  Ergebnis anonym teilen (hilft anderen, Vertrauen aufzubauen)
                </label>
              )}
              <button
                onClick={() => void startConversation()}
                disabled={loading}
                className={`self-start rounded px-3 py-1 text-white disabled:opacity-50 ${MODE_CONFIG[activeMode].colorClass}`}
              >
                {loading ? "…" : "Starten"}
              </button>
            </div>
          )}

          {conversation && (
            <div className="flex flex-col gap-2">
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                {conversation.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded px-2 py-1 ${
                      m.role === "user"
                        ? "self-end bg-gray-100"
                        : "self-start bg-gray-50 border"
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={followUpText}
                  onChange={(e) => setFollowUpText(e.target.value)}
                  placeholder="Nachfrage stellen…"
                  className="w-full rounded border px-1 py-0.5"
                />
                <button
                  onClick={() => void sendFollowUp()}
                  disabled={loading}
                  className={`shrink-0 rounded px-2 py-1 text-white disabled:opacity-50 ${MODE_CONFIG[activeMode].colorClass}`}
                >
                  {loading ? "…" : "Senden"}
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-1 text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
