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
    if (!confirm(isBlocked ? "Unblock this user?" : "Block this user?")) return;
    const method = isBlocked ? "DELETE" : "POST";
    await apiFetch(`/users/${username}/block`, { method });
    setIsBlocked(!isBlocked);
    await queryClient.invalidateQueries({ queryKey: ["profile", username] });
  }

  async function submitReport() {
    const reason = prompt("Why are you reporting this profile?");
    if (!reason) return;
    await apiFetch("/reports", {
      method: "POST",
      body: JSON.stringify({
        targetType: "user",
        targetId: profileQuery.data?.id,
        reason,
      }),
    });
    alert("Report submitted. Thank you.");
  }

  function onPostDeleted(postId: string) {
    setPosts((p) => p.filter((post) => post.id !== postId));
  }

  const profile = profileQuery.data;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader title="Profile" />
      <NavBar />
      {profileQuery.isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {profile && (
        <>
          <div className={`${card} mb-6 flex items-start gap-4`}>
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
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                <span>{profile.postCount} Posts</span>
                {profile.isMe ? (
                  <button type="button" onClick={() => setConnectionList("followers")} className="hover:text-gray-900 hover:underline">
                    {profile.followerCount} Followers
                  </button>
                ) : (
                  <span>{profile.followerCount} Followers</span>
                )}
                {profile.isMe ? (
                  <button type="button" onClick={() => setConnectionList("following")} className="hover:text-gray-900 hover:underline">
                    {profile.followingCount} Following
                  </button>
                ) : (
                  <span>{profile.followingCount} Following</span>
                )}
              </div>
              {!profile.isMe && (
                <div className="mt-2 flex gap-3 text-xs text-gray-400">
                  <button onClick={() => void toggleBlock()} className="hover:underline">
                    {isBlocked ? "Unblock" : "Block"}
                  </button>
                  <button onClick={() => void submitReport()} className="hover:underline">
                    Report
                  </button>
                </div>
              )}
            </div>
          </div>

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
                <p className="py-5 text-sm text-gray-500">Loading people...</p>
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
    </div>
  );
}
