import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import Avatar from "./Avatar.js";

export default function MomentReactions({ postId }: { postId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["moment-reactions", postId];
  const { data, isError } = useQuery({
    queryKey, queryFn: () => apiFetch<{ reactions: { emoji: string; user: PublicUser }[] }>(`/moments/posts/${postId}/reactions`),
    refetchInterval: 5_000,
  });
  const reactions = data?.reactions ?? [];
  const mine = reactions.find((reaction) => reaction.user.id === user?.id)?.emoji;
  async function react(emoji: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/moments/posts/${postId}/reactions`, { method: "POST", body: JSON.stringify({ emoji: mine === emoji ? null : emoji }) });
      await queryClient.invalidateQueries({ queryKey });
    } catch { setError("Could not send reaction. Please try again."); }
    finally { setBusy(false); }
  }
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8 text-white" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap justify-center gap-2">
        {["❤️", "🔥", "😂", "😍", "👏", "😮"].map((emoji) => (
          <button key={emoji} type="button" aria-label={`React ${emoji}`} aria-pressed={mine === emoji} disabled={busy}
            onClick={() => void react(emoji)} className={`flex h-10 w-10 items-center justify-center rounded-full border text-xl disabled:opacity-50 ${mine === emoji ? "border-white bg-white/25" : "border-white/20 bg-black/30"}`}>{emoji}</button>
        ))}
      </div>
      <div aria-label="Moment reactions" className="mx-auto mt-3 flex max-h-24 max-w-xl flex-wrap justify-center gap-2 overflow-y-auto">
        {reactions.map((reaction) => <span key={reaction.user.id} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 text-xs">
          <Avatar avatarKey={reaction.user.avatarKey} username={reaction.user.username} size={20} />
          @{reaction.user.username} {reaction.emoji}
        </span>)}
      </div>
      {(error || isError) && <p role="alert" className="mt-2 text-center text-xs text-red-200">{error ?? "Could not load reactions."}</p>}
    </div>
  );
}