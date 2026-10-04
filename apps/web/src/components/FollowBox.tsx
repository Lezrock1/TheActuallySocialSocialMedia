import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { PublicUser } from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";
import { card, input, btnSecondary } from "../lib/ui.js";
import Avatar from "./Avatar.js";

interface UserDirectoryPage {
  users: PublicUser[];
  nextCursor: string | null;
}

async function fetchUsers(query: string, cursor: string | null): Promise<UserDirectoryPage> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  return apiFetch<UserDirectoryPage>(`/users?${params.toString()}`);
}

export default function FollowBox({ focusRequest = 0 }: { focusRequest?: number }) {
  const queryClient = useQueryClient();
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastTarget, setLastTarget] = useState<string | null>(null);
  const search = username.trim().replace(/^@/, "");
  const directoryQuery = useInfiniteQuery({
    queryKey: ["user-directory", search],
    queryFn: ({ pageParam }) => fetchUsers(search, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: isOpen,
    staleTime: 30_000,
  });
  const users = directoryQuery.data?.pages.flatMap((page) => page.users) ?? [];

  useEffect(() => {
    if (focusRequest === 0) return;
    setIsOpen(true);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRequest]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !searchContainerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  async function onFollow(e: FormEvent) {
    e.preventDefault();
    const target = username.trim().replace(/^@/, "");
    if (!target) return;
    setStatus(null);
    try {
      await apiFetch(`/users/${target}/follow`, { method: "POST" });
      setStatus(`You are now following @${target}`);
      setLastTarget(target);
      setUsername("");
      await queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
    } catch (err) {
      setStatus(
        err instanceof ApiError ? err.message : "Could not follow this user"
      );
    }
  }

  return (
    <form onSubmit={(e) => void onFollow(e)} className={`${card} mb-6 flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <div
          ref={searchContainerRef}
          className="relative min-w-0 flex-1 basis-full sm:basis-auto"
        >
          <input
            ref={inputRef}
            value={username}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Follow a username or view a profile"
            className={`${input} w-full`}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls="user-directory-results"
            aria-autocomplete="list"
          />
          {isOpen && (
            <div
              id="user-directory-results"
              role="listbox"
              aria-label={search ? "Matching profiles" : "Recently joined profiles"}
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
              onScroll={(event) => {
                const element = event.currentTarget;
                const nearBottom =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 48;
                if (
                  nearBottom &&
                  directoryQuery.hasNextPage &&
                  !directoryQuery.isFetchingNextPage
                ) {
                  void directoryQuery.fetchNextPage();
                }
              }}
            >
              {directoryQuery.isPending ? (
                <p className="px-3 py-3 text-sm text-gray-500">Loading profiles...</p>
              ) : directoryQuery.isError ? (
                <button
                  type="button"
                  onClick={() => void directoryQuery.refetch()}
                  className="w-full px-3 py-3 text-left text-sm text-red-600 hover:bg-gray-50"
                >
                  Could not load profiles. Try again.
                </button>
              ) : users.length === 0 ? (
                <p className="px-3 py-3 text-sm text-gray-500">No profiles found.</p>
              ) : (
                <>
                  {users.map((user) => (
                    <Link
                      key={user.id}
                      to={`/u/${user.username}`}
                      role="option"
                      aria-selected="false"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                    >
                      <Avatar avatarKey={user.avatarKey} username={user.username} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {user.displayName || `@${user.username}`}
                        </span>
                        {user.displayName && (
                          <span className="block truncate text-xs text-gray-500">
                            @{user.username}
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                  {directoryQuery.isFetchingNextPage && (
                    <p className="px-3 py-2 text-center text-xs text-gray-500">
                      Loading more profiles...
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <button className={`${btnSecondary} min-h-10 shrink-0`}>Follow</button>
        {search && (
          <Link
            to={`/u/${encodeURIComponent(search)}`}
            onClick={() => setIsOpen(false)}
            className="shrink-0 px-2 py-2 text-xs font-medium text-gray-600 hover:underline"
          >
            View profile
          </Link>
        )}
      </div>
      {status && lastTarget && (
        <Link to={`/u/${lastTarget}`} className="text-xs text-gray-500 hover:underline">
          {status}
        </Link>
      )}
    </form>
  );
}
