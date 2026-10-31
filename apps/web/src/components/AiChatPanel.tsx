import { useEffect, useRef, useState, type ReactNode } from "react";
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

function Reasoning() {
  return (
    <span role="status" className="ai-reasoning">
      Reasoning
      <span aria-hidden="true" className="ai-reasoning-dots"><i>.</i><i>.</i><i>.</i></span>
    </span>
  );
}

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

export default function AiChatPanel({
  postId,
  externalPost,
  date,
  actions,
}: {
  postId?: string;
  externalPost?: ExternalFeedPost;
  date: ReactNode;
  actions?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const panelKey = postId ?? `external-${externalPost?.url ?? "post"}`;
  const [expanded, setExpanded] = useState(false);
  const lastScrollY = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const {
    data: providers = [],
    isError: providersError,
    isSuccess: providersLoaded,
  } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: fetchProviders,
    staleTime: 5 * 60 * 1000,
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

  // Keep the newest message (or the "Reasoning" bubble) in view while the answer arrives.
  const messageCount = conversation?.messages.length ?? 0;
  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messageCount, loading]);
  const conversationId = conversation?.id;
  useEffect(() => {
    if (conversationId) panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [conversationId]);

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
    <div className="mt-3 w-full">
      <div className="flex h-9 min-w-0 items-center justify-between gap-2">
        {date}
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={`ai-modes-${panelKey}`}
            className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 transition-[background-color,transform] hover:bg-gray-50 active:scale-95"
          >
            AI Tools
            <span aria-hidden="true" className="text-gray-400">{expanded ? "−" : "+"}</span>
          </button>
        </div>
      </div>
      <div
        id={`ai-modes-${panelKey}`}
        aria-hidden={!expanded}
        className={`w-full overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="mt-1 flex flex-wrap justify-end gap-1">
          {providers.length === 0 ? null :
            (Object.keys(MODE_CONFIG) as AiMode[]).map((mode, index) => (
              <button
                key={mode}
                type="button"
                tabIndex={expanded ? 0 : -1}
                aria-label={MODE_CONFIG[mode].label}
                onClick={() => openMode(mode)}
                style={{ transitionDelay: expanded ? `${index * 45}ms` : "0ms" }}
                className={`min-h-8 shrink-0 rounded-full px-2 text-[11px] font-semibold text-white transition-[opacity,transform,background-color] duration-200 ease-out active:!scale-95 ${
                  expanded ? "translate-y-0 scale-100 opacity-100" : "-translate-y-1 scale-95 opacity-0"
                } ${
                  activeMode === mode
                    ? MODE_CONFIG[mode].activeColorClass
                    : MODE_CONFIG[mode].colorClass
                }`}
              >
                {MODE_CONFIG[mode].label}
              </button>
            ))}
        </div>
      </div>

      {expanded && providersError && (
        <p className="mt-2 text-xs text-red-600">Could not load AI providers.</p>
      )}
      {expanded && providersLoaded && providers.length === 0 && (
        <p className="mt-2 text-xs text-gray-600">
          No providers configured. <Link to="/settings/ai" className="underline">Set up AI Tools</Link>.
        </p>
      )}

      {activeMode && providers.length > 0 && (
        <div ref={panelRef} className="ai-panel-enter mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm">
          {!conversation && (
            <div className="flex flex-col gap-2">
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="min-h-10 rounded border px-2 py-1"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              {providers.find((provider) => provider.id === providerId)?.apiKeySource === "missing" && (
                <p className="text-xs text-amber-700">
                  Add an API key in <Link to="/settings/ai" className="underline">AI Tools</Link> or ask the server admin to configure a shared key.
                </p>
              )}
              {activeMode === "custom" && (
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="What would you like to know about this post?"
                  className="w-full rounded border p-2"
                  rows={2}
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
                className={`min-h-10 self-start rounded px-3 py-1 text-white disabled:opacity-50 ${MODE_CONFIG[activeMode].colorClass}`}
              >
                {loading ? <Reasoning /> : "Start"}
              </button>
            </div>
          )}

          {conversation && (
            <div className="flex flex-col gap-2">
              <div ref={messagesRef} className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                {conversation.messages.filter((message, index) => !(index === 0 && message.role === "user" && message.content.startsWith("Post context:"))).map((message) => (
                  <div key={message.id} className={`max-w-[90%] break-words rounded px-3 py-2 ${message.role === "user" ? "self-end bg-gray-100" : "self-start border bg-gray-50"}`}>
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <AiMarkdown content={message.content} />
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="ai-panel-enter self-start rounded border bg-gray-50 px-3 py-2 text-gray-500">
                    <Reasoning />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={followUpText}
                  onChange={(e) => setFollowUpText(e.target.value)}
                  placeholder="Ask a follow-up..."
                  className="min-h-10 min-w-0 flex-1 rounded border px-3 py-2"
                />
                <button
                  type="button"
                  onClick={() => void sendFollowUp()}
                  disabled={loading}
                  className={`min-h-10 shrink-0 rounded px-3 text-white disabled:opacity-50 ${MODE_CONFIG[activeMode].colorClass}`}
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
