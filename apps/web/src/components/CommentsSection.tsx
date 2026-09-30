import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Comment } from "@app/shared";
import { apiFetch } from "../lib/api.js";

async function fetchComments(postId: string): Promise<Comment[]> {
  const res = await apiFetch<{ comments: Comment[] }>(`/posts/${postId}/comments`);
  return res.comments;
}

export default function CommentsSection({ postId }: { postId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => fetchComments(postId),
    enabled: open,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await apiFetch(`/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    setText("");
    await queryClient.invalidateQueries({ queryKey: ["comments", postId] });
  }

  return (
    <div className="mt-3 text-xs">
      <button onClick={() => setOpen((o) => !o)} className="font-medium text-gray-500 hover:underline">
        {open ? "Kommentare ausblenden" : "Kommentare anzeigen"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-gray-50 px-3 py-2">
              <span className="font-medium">@{c.author.username}</span>{" "}
              <span className="text-gray-700">{c.text}</span>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-gray-400">Noch keine Kommentare.</p>
          )}
          <form onSubmit={(e) => void onSubmit(e)} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Kommentar schreiben…"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5"
            />
            <button className="shrink-0 rounded-lg bg-black px-3 py-1.5 font-medium text-white">
              Senden
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
