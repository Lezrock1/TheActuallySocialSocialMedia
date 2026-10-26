import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ExternalFollowSummary, ExternalPlatform, ExternalProfile, PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import Avatar from "../components/Avatar.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";
import { activityList, activityRow, btnSecondary, input } from "../lib/ui.js";
import { PLATFORM_META } from "../lib/platforms.js";

type SearchScope = "intouch" | ExternalPlatform;

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
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("intouch");
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
  const quickPicks = (suggestionsQuery.data ?? []).slice(0, 4);
  const isLoading = deferredQuery ? searchQuery.isLoading : suggestionsQuery.isLoading;
  const isError = deferredQuery ? searchQuery.isError : suggestionsQuery.isError;
  const followMutation = useMutation({
    mutationFn: (person: PublicUser) => apiFetch(`/users/${person.username}/follow`, { method: "POST" }),
    onSuccess: async (_data, person) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["people-suggestions"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", person.username] }),
      ]);
    },
  });

  const externalFollowsQuery = useQuery({
    queryKey: ["external-follows"],
    queryFn: async () => (await apiFetch<{ follows: ExternalFollowSummary[] }>("/external/follows")).follows,
    staleTime: 30_000,
  });
  const externalSearchQuery = useQuery({
    queryKey: ["external-search", scope, deferredQuery],
    queryFn: async () =>
      (await apiFetch<{ profiles: ExternalProfile[] }>(
        `/external/search?platform=${scope}&q=${encodeURIComponent(deferredQuery)}`
      )).profiles,
    enabled: scope !== "intouch" && !!deferredQuery,
    staleTime: 30_000,
  });
  const externalFollowMutation = useMutation({
    mutationFn: (profile: ExternalProfile) =>
      apiFetch("/external/follows", {
        method: "POST",
        body: JSON.stringify({ platform: profile.platform, handle: profile.handle }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["external-follows"] }),
        queryClient.invalidateQueries({ queryKey: ["external-story-items"] }),
      ]);
    },
  });
  const externalUnfollowMutation = useMutation({
    mutationFn: (followId: string) => apiFetch(`/external/follows/${followId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["external-follows"] }),
  });
  const externalFollows = externalFollowsQuery.data ?? [];
  const externalResults = externalSearchQuery.data ?? [];
  const platformFollows = externalFollows.filter((follow) => follow.platform === scope);

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Find people" />
      <NavBar />

      <section className="mb-4 rounded-2xl border border-gray-200 bg-[linear-gradient(140deg,#f0f9ff_0%,#ffffff_55%,#eef2ff_100%)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Discover</p>
        <p className="mt-1 text-sm text-gray-700">Find people by name, username, or mutual network.</p>
        {!deferredQuery && quickPicks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {quickPicks.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setQuery(`@${person.username}`)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                @{person.username}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="people-search" className="sr-only">Search people by name or username</label>
        <input
          ref={inputRef}
          id="people-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={scope === "intouch" ? "Search by name or @username" : `Search ${PLATFORM_META[scope].label}…`}
          className={`${input} min-w-0 flex-1`}
          autoComplete="off"
        />
        <label htmlFor="search-scope" className="sr-only">Choose which platform to search</label>
        <select
          id="search-scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as SearchScope)}
          className="h-11 shrink-0 cursor-pointer rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 focus:border-emerald-500 focus:outline-none"
        >
          <option value="intouch">InTouch</option>
          <option value="bluesky">Bluesky</option>
          <option value="mastodon">Mastodon</option>
          <option value="youtube">YouTube</option>
          <option value="twitch">Twitch</option>
        </select>
      </div>

      {scope === "intouch" && (
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
            {deferredQuery ? "No matching profiles found." : "No more suggestions right now."}
          </p>
        ) : (
          <div className={activityList}>
            {users.map((person) => (
              <div
                key={person.id}
                className={`${activityRow} motion-safe:animate-[menu-enter_220ms_ease-out]`}
              >
                <Link to={`/u/${person.username}`} className="flex min-w-0 flex-1 items-center gap-3">
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
                {deferredQuery && <span className="text-xs font-medium text-gray-500">View profile</span>}
                </Link>
                {!deferredQuery && <button type="button" aria-label={`Follow @${person.username}`} disabled={followMutation.isPending} onClick={() => followMutation.mutate(person)} className={`${btnSecondary} shrink-0 text-xs`}>
                  {followMutation.isPending && followMutation.variables?.id === person.id ? "Following..." : "Follow"}
                </button>}
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {scope !== "intouch" && (
        <section aria-label={`${PLATFORM_META[scope].label} profiles`}>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            {deferredQuery ? `${PLATFORM_META[scope].label} results` : `Your ${PLATFORM_META[scope].label} follows`}
          </h2>
          {deferredQuery ? (
            externalSearchQuery.isLoading ? (
              <CardListSkeleton rows={3} />
            ) : externalResults.length === 0 ? (
              <p className="py-4 text-sm text-gray-500">No matching profiles found.</p>
            ) : (
              <div className={activityList}>
                {externalResults.map((profile) => {
                  const existing = externalFollows.find(
                    (follow) => follow.platform === profile.platform && follow.externalId === profile.externalId
                  );
                  return (
                    <div key={`${profile.platform}:${profile.externalId}`} className={`${activityRow} motion-safe:animate-[menu-enter_220ms_ease-out]`}>
                      <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
                        {profile.avatarUrl ? (
                          <img src={profile.avatarUrl} alt="" loading="lazy" className="h-[42px] w-[42px] shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
                            {(profile.displayName ?? profile.handle).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-gray-900">
                            {profile.displayName || `@${profile.handle}`}
                          </span>
                          <span className="block truncate text-xs text-gray-500">@{profile.handle}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${PLATFORM_META[profile.platform].badgeClass}`}>
                          {PLATFORM_META[profile.platform].label}
                        </span>
                      </a>
                      <button
                        type="button"
                        disabled={externalFollowMutation.isPending || externalUnfollowMutation.isPending}
                        onClick={() => existing ? externalUnfollowMutation.mutate(existing.followId) : externalFollowMutation.mutate(profile)}
                        aria-pressed={!!existing}
                        className={`${btnSecondary} shrink-0 text-xs`}
                      >
                        {existing ? "Following ✓" : "Follow"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : platformFollows.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">
              You don't follow any {PLATFORM_META[scope].label} profiles yet. Search for a handle above.
            </p>
          ) : (
            <div className={activityList}>
              {platformFollows.map((follow) => (
                <div key={follow.followId} className={activityRow}>
                  <a href={follow.profileUrl} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
                    {follow.avatarUrl ? (
                      <img src={follow.avatarUrl} alt="" loading="lazy" className="h-[42px] w-[42px] shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
                        {(follow.displayName ?? follow.handle).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {follow.displayName || `@${follow.handle}`}
                      </span>
                      <span className="block truncate text-xs text-gray-500">@{follow.handle}</span>
                    </span>
                    {follow.isLive && (
                      <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">LIVE</span>
                    )}
                  </a>
                  <button
                    type="button"
                    disabled={externalUnfollowMutation.isPending}
                    onClick={() => externalUnfollowMutation.mutate(follow.followId)}
                    className={`${btnSecondary} shrink-0 text-xs`}
                  >
                    Unfollow
                  </button>
                </div>
              ))}
            </div>
          )}
          {externalFollowMutation.isError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {externalFollowMutation.error instanceof Error ? externalFollowMutation.error.message : "Could not follow this profile."}
            </p>
          )}
        </section>
      )}
      {followMutation.isError && <p role="alert" className="mt-3 text-sm text-red-600">Could not follow this profile. Try again.</p>}

      {scope === "intouch" && deferredQuery && searchQuery.hasNextPage && (
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