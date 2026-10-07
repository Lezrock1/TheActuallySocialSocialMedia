import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import Avatar from "../components/Avatar.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";
import { btnSecondary, input } from "../lib/ui.js";

interface UserDirectoryPage {
  users: PublicUser[];
  nextCursor: string | null;
}

interface SuggestedUser extends PublicUser {
  mutualCount: number;
}

async function fetchDirectory(query: string, cursor: string | null): Promise<UserDirectoryPage> {
  const params = new URLSearchParams({ q: query });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<UserDirectoryPage>(`/users?${params.toString()}`);
}

async function fetchSuggestions(): Promise<SuggestedUser[]> {
  const res = await apiFetch<{ users: SuggestedUser[] }>("/users/suggestions");
  return res.users;
}

export default function PeopleSearchPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().replace(/^@/, ""));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestionsQuery = useQuery({
    queryKey: ["people-suggestions"],
    queryFn: fetchSuggestions,
    enabled: !deferredQuery,
    staleTime: 60_000,
  });
  const searchQuery = useInfiniteQuery({
    queryKey: ["people-search", deferredQuery],
    queryFn: ({ pageParam }) => fetchDirectory(deferredQuery, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!deferredQuery,
    staleTime: 30_000,
  });

  const users: Array<PublicUser & { mutualCount?: number }> = deferredQuery
    ? searchQuery.data?.pages.flatMap((page) => page.users) ?? []
    : suggestionsQuery.data ?? [];
  const isLoading = deferredQuery ? searchQuery.isLoading : suggestionsQuery.isLoading;
  const isError = deferredQuery ? searchQuery.isError : suggestionsQuery.isError;

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Find people" />
      <NavBar />

      <label htmlFor="people-search" className="sr-only">Search people by name or username</label>
      <input
        ref={inputRef}
        id="people-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name or @username"
        className={`${input} mb-4 w-full`}
        autoComplete="off"
      />

      <section aria-label={deferredQuery ? "Search results" : "People you may know"}>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {deferredQuery ? "Search results" : "Suggested for you"}
        </h2>
        {isLoading ? (
          <CardListSkeleton rows={3} />
        ) : isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">Could not load people. Try again.</p>
        ) : users.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">
            {deferredQuery ? "No matching profiles found." : "Follow people to get friend-based suggestions."}
          </p>
        ) : (
          <div className="divide-y divide-gray-100 border-y border-gray-100">
            {users.map((person) => (
              <Link
                key={person.id}
                to={`/u/${person.username}`}
                className="flex items-center gap-3 py-3 hover:bg-gray-50"
              >
                <Avatar avatarKey={person.avatarKey} username={person.username} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">
                    {person.displayName || `@${person.username}`}
                  </span>
                  {person.displayName && (
                    <span className="block truncate text-xs text-gray-500">@{person.username}</span>
                  )}
                  {person.mutualCount !== undefined && (
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {person.mutualCount} mutual {person.mutualCount === 1 ? "follow" : "follows"}
                    </span>
                  )}
                </span>
                <span className="text-xs font-medium text-gray-500">View profile</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {deferredQuery && searchQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => void searchQuery.fetchNextPage()}
          disabled={searchQuery.isFetchingNextPage}
          className={`${btnSecondary} mt-4 w-full`}
        >
          {searchQuery.isFetchingNextPage ? "Loading more people..." : "Load more"}
        </button>
      )}
    </div>
  );
}