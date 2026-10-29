import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiConversation,
  AiMode,
  AiProviderConfigPublic,
  ExternalFeedPost,
} from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";
import AiMarkdown from "./AiMarkdown.js";
import { InlineSkeletonText } from "./LoadingSkeleton.js";

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

export default function AiChatPanel({ postId, externalPost }: { postId?: string; externalPost?: ExternalFeedPost }) {
  const queryClient = useQueryClient();
  const panelKey = postId ?? `external-${externalPost?.url ?? "post"}`;
  const [expanded, setExpanded] = useState(false);
  const lastScrollY = useRef(0);
  const {
    data: providers = [],
    isLoading: providersLoading,
    isError: providersError,
  } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: fetchProviders,
    enabled: expanded,
  });

  const [activeMode, setActiveMode] = useState<AiMode | null>(null);
  const [providerId, setProviderId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [shareResult, setShareResult] = useState(false);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [followUpText, setFollowUpText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    lastScrollY.current = window.scrollY;
    function collapseOnDownwardScroll() {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current + 6) setExpanded(false);
      lastScrollY.current = currentScrollY;
    }
    window.addEventListener("scroll", collapseOnDownwardScroll, { passive: true });
    return () => window.removeEventListener("scroll", collapseOnDownwardScroll);
  }, [expanded]);

  function openMode(mode: AiMode) {
    setExpanded(false);
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
            postId: postId ?? undefined,
            external: externalPost
              ? {
                  platform: externalPost.platform,
                  authorHandle: externalPost.authorHandle,
                  authorName: externalPost.authorName,
                  text: externalPost.text,
                  url: externalPost.url,
                  publishedAt: externalPost.publishedAt,
                }
              : undefined,
            providerConfigId: providerId,
            mode: activeMode,
            customPrompt: activeMode === "custom" ? customPrompt : undefined,
            shared: activeMode === "factcheck" && postId ? shareResult : undefined,
          }),
        }
      );
      setConversation(res.conversation);
      if (activeMode === "factcheck" && shareResult && postId) {
        void queryClient.invalidateQueries({
          queryKey: ["factcheck-summary", postId],
        });
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "The AI provider request failed"
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
        err instanceof ApiError ? err.message : "The AI provider request failed"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="w-full min-w-0">
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={`ai-modes-${panelKey}`}
          className="flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          AI Tools
          <span aria-hidden="true" className="text-gray-400">{expanded ? "−" : "+"}</span>
        </button>
        <div
          id={`ai-modes-${panelKey}`}
          aria-hidden={!expanded}
          className={`flex w-full flex-col gap-1.5 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-lg shadow-gray-900/5 transition-[max-height,opacity] duration-300 ease-out ${
            expanded ? "max-h-40 opacity-100" : "max-h-0 border-transparent p-0 opacity-0"
          }`}
        >
          {providers.length === 0 ? null :
            (Object.keys(MODE_CONFIG) as AiMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                tabIndex={expanded ? 0 : -1}
                aria-label={MODE_CONFIG[mode].label}
                onClick={() => openMode(mode)}
                className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold transition-colors ${
                  activeMode === mode
                    ? `${MODE_CONFIG[mode].activeColorClass} text-white shadow-sm`
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span>{MODE_CONFIG[mode].label}</span>
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${activeMode === mode ? "bg-white" : "bg-gray-300"}`} />
              </button>
            ))}
        </div>
      </div>

      {expanded && providersLoading && (
        <div className="mt-2 flex justify-end" aria-hidden="true">
          <InlineSkeletonText width="w-24" />
        </div>
      )}
      {expanded && providersError && (
        <p className="mt-2 text-right text-xs text-red-600">Could not load AI providers.</p>
      )}
      {expanded && !providersLoading && !providersError && providers.length === 0 && (
        <p className="mt-2 text-right text-xs text-gray-600">
          No providers configured. <Link to="/settings/ai" className="underline">Set up AI Tools</Link>.
        </p>
      )}

      {activeMode && providers.length > 0 && (
        <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm shadow-sm">
          {!conversation && (
            <div className="flex flex-col gap-3">
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              {providers.find((provider) => provider.id === providerId)?.apiKeySource === "missing" && (
                <p className="text-xs text-amber-700">
                  Add an API key in <Link to="/settings/ai" className="underline">AI Tools</Link> or ask the server admin to configure a shared OpenRouter key.
                </p>
              )}
              {activeMode === "custom" && (
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="What would you like to know about this post?"
                  className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm focus:border-gray-400 focus:outline-none"
                  rows={3}
                />
              )}
              {activeMode === "factcheck" && postId && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={shareResult} onChange={(e) => setShareResult(e.target.checked)} />
                  Share this result anonymously to help others build trust
                </label>
              )}
              <button
                type="button"
                onClick={() => void startConversation()}
                disabled={loading}
                className={`min-h-11 self-start rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${MODE_CONFIG[activeMode].colorClass}`}
              >
                {loading ? "Starting..." : "Start"}
              </button>
            </div>
          )}

          {conversation && (
            <div className="flex flex-col gap-3">
              <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
                {conversation.messages.map((message) => (
                  <div key={message.id} className={`max-w-[92%] break-words rounded-2xl px-4 py-3 ${message.role === "user" ? "self-end bg-gray-100" : "self-start border border-gray-200 bg-gray-50"}`}>
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <AiMarkdown content={message.content} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={followUpText}
                  onChange={(e) => setFollowUpText(e.target.value)}
                  placeholder="Ask a follow-up..."
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void sendFollowUp()}
                  disabled={loading}
                  className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50 ${MODE_CONFIG[activeMode].colorClass}`}
                >
                  {loading ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          )}

          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </section>
  );
}
