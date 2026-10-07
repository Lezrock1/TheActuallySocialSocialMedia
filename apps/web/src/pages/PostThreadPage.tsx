import { useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedPost } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PostCard from "../components/PostCard.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";
import { card, input, btnPrimary } from "../lib/ui.js";

interface ThreadResponse {
  parent: FeedPost | null;
  post: FeedPost;
  replies: FeedPost[];
}

async function fetchThread(postId: string): Promise<ThreadResponse> {
  return apiFetch<ThreadResponse>(`/posts/${postId}/thread`);
}

export default function PostThreadPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["thread", id],
    queryFn: () => fetchThread(id),
  });

  async function onReply(e: FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    await apiFetch("/posts", {
      method: "POST",
      body: JSON.stringify({ text: replyText, parentPostId: id }),
    });
    setReplyText("");
    await queryClient.invalidateQueries({ queryKey: ["thread", id] });
  }

  function onDeleted() {
    void queryClient.invalidateQueries({ queryKey: ["thread", id] });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Post" />
      <NavBar />
      {isLoading && <CardListSkeleton rows={2} />}
      {data && (
        <div className="flex flex-col gap-3">
          {data.parent && (
            <div className="text-xs text-gray-400">
              Reply to @{data.parent.author.username}
            </div>
          )}
          {data.parent && <PostCard post={data.parent} currentUserId={user?.id} onDeleted={onDeleted} />}
          <div className="border-l-2 border-black pl-3">
            <PostCard post={data.post} currentUserId={user?.id} onDeleted={onDeleted} />
          </div>

          <form onSubmit={(e) => void onReply(e)} className={`${card} flex flex-col gap-2`}>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply..."
              className={`${input} resize-none`}
              rows={2}
            />
            <button className={`${btnPrimary} self-end`}>Reply</button>
          </form>

          <h2 className="mt-2 text-sm font-medium text-gray-500">
            {data.replies.length} replies
          </h2>
          {data.replies.map((reply) => (
            <PostCard
              key={reply.id}
              post={reply}
              currentUserId={user?.id}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
