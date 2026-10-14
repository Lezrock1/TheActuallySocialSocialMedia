import { useParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { FeedPost } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PostCard from "../components/PostCard.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";

export default function HashtagPage() {
  const { tag = "" } = useParams();
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ["hashtag-posts", tag], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<{ posts: FeedPost[]; nextCursor: string | null }>(`/hashtags/${encodeURIComponent(tag)}/posts${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const posts = query.data?.pages.flatMap((page) => page.posts) ?? [];
  return (
    <main className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title={`#${tag}`} /><NavBar />
      <p className="mb-5 text-xs text-gray-500">Recent posts</p>
      {query.isPending && <CardListSkeleton rows={3} />}
      {query.isError && <p role="alert" className="py-6 text-sm text-gray-600">Could not load this hashtag. <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button></p>}
      <div className="space-y-3">{posts.map((post) => <PostCard key={post.id} post={post} currentUserId={user?.id} onDeleted={() => void query.refetch()} />)}</div>
      {query.isSuccess && !posts.length && <p className="py-10 text-center text-sm text-gray-500">No posts with this hashtag yet.</p>}
      {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="mt-5 w-full rounded-lg border border-gray-200 py-3 text-sm font-semibold disabled:opacity-50">{query.isFetchingNextPage ? "Loading..." : "Load more"}</button>}
    </main>
  );
}