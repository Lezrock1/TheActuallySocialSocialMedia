import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedPost, PublicUser, UserProfile } from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PostCard from "../components/PostCard.js";
import Avatar from "../components/Avatar.js";
import AppDialog from "../components/AppDialog.js";
import Sheet from "../components/Sheet.js";
import SecurityCodeSheet from "../components/SecurityCodeSheet.js";
import CloseFriendsSheet from "../components/CloseFriendsSheet.js";
import { useCircles } from "../lib/circles.js";
import type { PublicEncryptionKey } from "../lib/encryption.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";
import { InlineSkeletonText } from "../components/LoadingSkeleton.js";
import { card, input, btnPrimary, btnSecondary } from "../lib/ui.js";

async function fetchProfile(username: string): Promise<UserProfile> {
  const res = await apiFetch<{ profile: UserProfile }>(`/users/${username}`);
  return res.profile;
}

async function fetchUserPosts(
  username: string,
  cursor: string | null
): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return apiFetch(`/users/${username}/posts?${params.toString()}`);
}

export default function ProfilePage() {
  const { username = "" } = useParams();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [connectionList, setConnectionList] = useState<"followers" | "following" | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockPending, setBlockPending] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  const [circlesOpen, setCirclesOpen] = useState(false);
  const [ownCirclesOpen, setOwnCirclesOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const circlesQuery = useCircles();
  const containingQuery = useQuery({
    queryKey: ["circles-containing", username],
    queryFn: async () => (await apiFetch<{ circleIds: string[] }>(`/circles/containing/${encodeURIComponent(username)}`)).circleIds,
    enabled: circlesOpen,
  });
  const keysQuery = useQuery({
    queryKey: ["profile-encryption-keys", username],
    queryFn: async () => {
      const [mine, theirs] = await Promise.all([
        apiFetch<{ keys: PublicEncryptionKey[] }>("/users/me/encryption-keys"),
        apiFetch<{ keys: PublicEncryptionKey[] }>(`/users/${encodeURIComponent(username)}/encryption-keys`),
      ]);
      return [...mine.keys, ...theirs.keys];
    },
    enabled: securityOpen,
  });

  async function toggleCircleMember(circleId: string, isMember: boolean) {
    setProfileActionError(null);
    try {
      if (isMember) {
        await apiFetch(`/circles/${circleId}/members/${encodeURIComponent(username)}`, { method: "DELETE" });
      } else {
        await apiFetch(`/circles/${circleId}/members`, { method: "POST", body: JSON.stringify({ username }) });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["circles-containing", username] }),
        queryClient.invalidateQueries({ queryKey: ["circles"] }),
        queryClient.invalidateQueries({ queryKey: ["circle", circleId] }),
      ]);
    } catch (caught) {
      setProfileActionError(caught instanceof Error ? caught.message : "Could not update the circle.");
    }
  }

  const profileQuery = useQuery({
    queryKey: ["profile", username],
    queryFn: () => fetchProfile(username),
  });
  const connectionQuery = useQuery({
    queryKey: ["profile-connections", username, connectionList],
    queryFn: () => {
      if (!connectionList) throw new Error("No connection list selected");
      return apiFetch<{ users: PublicUser[] }>(`/users/${username}/${connectionList}`);
    },
    enabled: !!connectionList,
  });

  useEffect(() => {
    setPosts([]);
    setNextCursor(null);
    setPostsLoaded(false);
  }, [username]);

  useEffect(() => {
    if (!profileQuery.data || postsLoaded) return;
    setPostsLoaded(true);
    fetchUserPosts(username, null).then((res) => {
      setPosts(res.posts);
      setNextCursor(res.nextCursor);
    });
  }, [profileQuery.data, postsLoaded, username]);

  async function loadMorePosts() {
    if (!nextCursor) return;
    const res = await fetchUserPosts(username, nextCursor);
    setPosts((p) => [...p, ...res.posts]);
    setNextCursor(res.nextCursor);
  }

  function startEditing() {
    if (!profileQuery.data) return;
    setDisplayName(profileQuery.data.displayName ?? "");
    setBio(profileQuery.data.bio ?? "");
    setEditing(true);
  }

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName, bio }),
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["profile", username] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  async function onAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const avatarKey = await uploadMedia(file);
    await apiFetch("/users/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey }),
    });
    await queryClient.invalidateQueries({ queryKey: ["profile", username] });
  }

  async function toggleFollow() {
    if (!profileQuery.data) return;
    const method = profileQuery.data.isFollowedByMe ? "DELETE" : "POST";
    await apiFetch(`/users/${username}/follow`, { method });
    await queryClient.invalidateQueries({ queryKey: ["profile", username] });
  }

  const closeFriendsQuery = useQuery({
    queryKey: ["close-friends"],
    queryFn: () =>
      apiFetch<{ users: { username: string }[] }>("/users/me/close-friends").then(
        (r) => r.users
      ),
  });
  const isCloseFriend = !!closeFriendsQuery.data?.some((u) => u.username === username);

  async function toggleCloseFriend() {
    const method = isCloseFriend ? "DELETE" : "POST";
    await apiFetch(`/users/${username}/close-friend`, { method });
    await queryClient.invalidateQueries({ queryKey: ["close-friends"] });
  }

  async function toggleBlock() {
    setBlockPending(true);
    setProfileActionError(null);
    const method = isBlocked ? "DELETE" : "POST";
    try {
      await apiFetch(`/users/${username}/block`, { method });
      setIsBlocked(!isBlocked);
      setBlockDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["profile", username] });
    } catch (error) {
      setProfileActionError(error instanceof Error ? error.message : "Could not update the block status.");
    } finally {
      setBlockPending(false);
    }
  }

  async function submitReport() {
    if (!reportReason.trim()) return;
    setReportPending(true);
    setProfileActionError(null);
    try {
      await apiFetch("/reports", {
        method: "POST",
        body: JSON.stringify({
          targetType: "user",
          targetId: profileQuery.data?.id,
          reason: reportReason.trim(),
        }),
      });
      setReportDialogOpen(false);
      setReportReason("");
      setReportStatus("Report submitted. Thank you.");
    } catch (error) {
      setProfileActionError(error instanceof Error ? error.message : "Could not submit this report.");
    } finally {
      setReportPending(false);
    }
  }

  function onPostDeleted(postId: string) {
    setPosts((p) => p.filter((post) => post.id !== postId));
  }

  const profile = profileQuery.data;

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Profile" />
      <NavBar />
      {profileQuery.isLoading && <CardListSkeleton rows={3} />}
      {profile && (
        <>
          <div className={`${card} mb-6`}>
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              {profile.isMe && editing ? (
                <button
                  type="button"
                  aria-label="Change profile picture"
                  title="Change profile picture"
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative block rounded-full focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
                >
                  <Avatar avatarKey={profile.avatarKey} username={profile.username} size={72} />
                  <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-black text-sm text-white shadow">
                    📷
                  </span>
                </button>
              ) : (
                <Avatar avatarKey={profile.avatarKey} username={profile.username} size={72} />
              )}
              {profile.isMe && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onAvatarSelected(e)}
                />
              )}
            </div>
            <div className="flex-1">
              <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <h1 className="min-w-0 break-words text-lg font-semibold">
                  @{profile.username}
                  {profile.displayName && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {profile.displayName}
                    </span>
                  )}
                </h1>
                {profile.isMe ? (
                  <button onClick={startEditing} className={`${btnSecondary} self-start sm:self-auto`}>
                    Edit profile
                  </button>
                ) : (
                  <div className="flex w-full gap-2 sm:w-auto">
                    <button
                      onClick={() => void toggleFollow()}
                      className={`${btnSecondary} min-h-9 min-w-0 flex-1 px-2 py-1.5 text-center text-xs sm:min-h-10 sm:flex-none sm:px-3 sm:text-sm`}
                    >
                      {profile.isFollowedByMe ? "Unfollow" : "Follow"}
                    </button>
                    <button
                      onClick={() => void toggleCloseFriend()}
                      aria-label={isCloseFriend ? "Remove from close friends" : "Add to close friends"}
                      className={`${btnSecondary} min-h-9 min-w-0 flex-1 px-2 py-1.5 text-center text-xs sm:min-h-10 sm:flex-none sm:px-3 sm:text-sm ${isCloseFriend ? "bg-green-50 border-green-300 text-green-800" : ""}`}
                    >
                      <span className="sm:hidden">{isCloseFriend ? "Close friend" : "+ Close"}</span>
                      <span className="hidden sm:inline">{isCloseFriend ? "Close friend" : "+ Close friend"}</span>
                    </button>
                  </div>
                )}
              </div>
              {profile.bio && <p className="mt-1 text-sm">{profile.bio}</p>}
              {profile.isMe && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOwnCirclesOpen(true)}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></svg>
                    Circles
                  </button>
                </div>
              )}

              {!profile.isMe && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCirclesOpen(true)}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></svg>
                    Circles
                  </button>
                  <button
                    type="button"
                    onClick={() => setSecurityOpen(true)}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
                    Security code
                  </button>
                </div>
              )}
              {!profile.isMe && (
                <div className="mt-2 flex gap-3 text-xs text-gray-400">
                  <button onClick={() => setBlockDialogOpen(true)} className="hover:underline">
                    {isBlocked ? "Unblock" : "Block"}
                  </button>
                  <button onClick={() => setReportDialogOpen(true)} className="hover:underline">
                    Report
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 pt-3 text-center">
            <div className="px-2">
              <span className="block text-base font-semibold tabular-nums text-gray-900">{profile.postCount}</span>
              <span className="block text-xs text-gray-500">Posts</span>
            </div>
            {(["followers", "following"] as const).map((kind) => {
              const count = kind === "followers" ? profile.followerCount : profile.followingCount;
              const label = kind === "followers" ? "Followers" : "Following";
              const content = (
                <>
                  <span className="block text-base font-semibold tabular-nums text-gray-900">{count}</span>
                  <span className="block text-xs text-gray-500">{label}</span>
                </>
              );
              return profile.isMe ? (
                <button key={kind} type="button" onClick={() => setConnectionList(kind)} className="rounded-lg px-2 transition-colors hover:bg-gray-50 active:bg-gray-100">
                  {content}
                </button>
              ) : (
                <div key={kind} className="px-2">{content}</div>
              );
            })}
          </div>
          </div>

          {reportStatus && <p role="status" className="mb-3 text-sm text-green-700">{reportStatus}</p>}          {profileActionError && <p role="alert" className="mb-3 text-sm text-red-600">{profileActionError}</p>}

          {editing && (
            <div className={`${card} mb-6 flex flex-col gap-2`}>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                className={input}
              />
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Bio"
                className={input}
                rows={3}
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditing(false)} className={btnSecondary}>
                  Cancel
                </button>
                <button onClick={() => void saveProfile()} disabled={saving} className={btnPrimary}>
                  Save
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={currentUser?.id}
                onDeleted={onPostDeleted}
              />
            ))}
            {posts.length === 0 && postsLoaded && (
              <p className="text-sm text-gray-400">No posts yet.</p>
            )}
          </div>

          {nextCursor && (
            <button
              onClick={() => void loadMorePosts()}
              className="mt-4 w-full rounded border py-2 text-sm"
            >
              Load more posts
            </button>
          )}
        </>
      )}
      {profile && profile.isMe && (
        <CloseFriendsSheet open={ownCirclesOpen} onClose={() => setOwnCirclesOpen(false)} />
      )}
      {profile && !profile.isMe && (
        <>
          <Sheet open={circlesOpen} onClose={() => setCirclesOpen(false)} title={`Circles for @${profile.username}`}>
            {circlesQuery.data && circlesQuery.data.circles.length === 0 ? (
              <div className="py-2 text-sm text-gray-600">
                <p>You have no circles yet.</p>
                <Link to="/circles" className="mt-2 inline-block font-medium text-blue-600 hover:underline">Create one</Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(circlesQuery.data?.circles ?? []).map((circle) => {
                  const isMember = !!containingQuery.data?.includes(circle.id);
                  return (
                    <li key={circle.id}>
                      <label className="flex cursor-pointer items-center gap-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900">{circle.name}</span>
                          <span className="block text-xs text-gray-500">{circle.memberCount} members</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={isMember}
                          disabled={containingQuery.isLoading}
                          onChange={() => void toggleCircleMember(circle.id, isMember)}
                          className="h-5 w-5 accent-[#1D9BF0]"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs leading-5 text-gray-500">
              Members are notified and can see what you share with that circle.
            </p>
            {profileActionError && <p role="alert" className="mt-2 text-xs text-red-600">{profileActionError}</p>}
          </Sheet>
          {currentUser && securityOpen && keysQuery.data && (
            <SecurityCodeSheet
              open
              onClose={() => setSecurityOpen(false)}
              meId={currentUser.id}
              peers={[{ id: profile.id, username: profile.username, avatarKey: profile.avatarKey }]}
              keys={keysQuery.data}
            />
          )}
        </>
      )}
      {connectionList && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setConnectionList(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-list-title"
            className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 id="connection-list-title" className="text-sm font-semibold">
                {connectionList === "followers" ? "Followers" : "Following"}
              </h2>
              <button
                type="button"
                aria-label="Close list"
                onClick={() => setConnectionList(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gray-500 hover:bg-gray-100"
              >
                ×
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-4">
              {connectionQuery.isLoading ? (
                <div aria-hidden="true" className="space-y-2 py-5">
                  <InlineSkeletonText width="w-28" />
                  <InlineSkeletonText width="w-40" />
                  <InlineSkeletonText width="w-32" />
                </div>
              ) : connectionQuery.isError ? (
                <p role="alert" className="py-5 text-sm text-red-600">Could not load this list.</p>
              ) : connectionQuery.data?.users.length ? (
                <div className="divide-y divide-gray-100">
                  {connectionQuery.data.users.map((person) => (
                    <Link
                      key={person.id}
                      to={`/u/${person.username}`}
                      onClick={() => setConnectionList(null)}
                      className="flex items-center gap-3 py-3 hover:bg-gray-50"
                    >
                      <Avatar avatarKey={person.avatarKey} username={person.username} size={38} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{person.displayName || `@${person.username}`}</span>
                        {person.displayName && <span className="block truncate text-xs text-gray-500">@{person.username}</span>}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="py-5 text-sm text-gray-500">No {connectionList} yet.</p>
              )}
            </div>
          </section>
        </div>
      )}

      <AppDialog
        open={blockDialogOpen}
        title={isBlocked ? "Unblock this user?" : "Block this user?"}
        description={isBlocked ? "You will be able to interact again." : "You and this user will no longer interact with each other."}
        confirmLabel={isBlocked ? "Unblock" : "Block"}
        danger={!isBlocked}
        pending={blockPending}
        onClose={() => setBlockDialogOpen(false)}
        onConfirm={() => void toggleBlock()}
      />

      <AppDialog
        open={reportDialogOpen}
        title="Report this profile"
        description="Tell us briefly what happened."
        confirmLabel="Send report"
        pending={reportPending}
        onClose={() => setReportDialogOpen(false)}
        onConfirm={() => void submitReport()}
      >
        <textarea
          value={reportReason}
          onChange={(event) => setReportReason(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Reason for this report"
          className={input}
        />
      </AppDialog>
    </div>
  );
}
