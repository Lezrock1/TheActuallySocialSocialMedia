import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedPost, UserProfile } from "@app/shared";
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

  const profileQuery = useQuery({
    queryKey: ["profile", username],
    queryFn: () => fetchProfile(username),
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
      setError(err instanceof ApiError ? err.message : "Speichern fehlgeschlagen");
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
    if (!confirm(isBlocked ? "Entblocken?" : "Diesen Nutzer wirklich blockieren?")) return;
    const method = isBlocked ? "DELETE" : "POST";
    await apiFetch(`/users/${username}/block`, { method });
    setIsBlocked(!isBlocked);
    await queryClient.invalidateQueries({ queryKey: ["profile", username] });
  }

  async function submitReport() {
    const reason = prompt("Warum meldest du dieses Profil?");
    if (!reason) return;
    await apiFetch("/reports", {
      method: "POST",
      body: JSON.stringify({
        targetType: "user",
        targetId: profileQuery.data?.id,
        reason,
      }),
    });
    alert("Meldung gesendet. Danke.");
  }

  function onPostDeleted(postId: string) {
    setPosts((p) => p.filter((post) => post.id !== postId));
  }

  const profile = profileQuery.data;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader title="Profil" />
      <NavBar />
      {profileQuery.isLoading && <p className="text-sm text-gray-500">Lädt…</p>}
      {profile && (
        <>
          <div className={`${card} mb-6 flex items-start gap-4`}>
            <Avatar avatarKey={profile.avatarKey} username={profile.username} size={72} />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold">
                  @{profile.username}
                  {profile.displayName && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {profile.displayName}
                    </span>
                  )}
                </h1>
                {profile.isMe ? (
                  <button onClick={startEditing} className={btnSecondary}>
                    Profil bearbeiten
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => void toggleFollow()} className={btnSecondary}>
                      {profile.isFollowedByMe ? "Entfolgen" : "Folgen"}
                    </button>
                    <button
                      onClick={() => void toggleCloseFriend()}
                      className={`${btnSecondary} ${isCloseFriend ? "bg-green-50 border-green-300 text-green-800" : ""}`}
                    >
                      {isCloseFriend ? "Enger Freund" : "+ Enger Freund"}
                    </button>
                  </div>
                )}
              </div>
              {profile.bio && <p className="mt-1 text-sm">{profile.bio}</p>}
              <div className="mt-2 flex gap-4 text-sm text-gray-500">
                <span>{profile.postCount} Posts</span>
                <span>{profile.followerCount} Follower</span>
                <span>{profile.followingCount} Folgt</span>
              </div>
              {!profile.isMe && (
                <div className="mt-2 flex gap-3 text-xs text-gray-400">
                  <button onClick={() => void toggleBlock()} className="hover:underline">
                    {isBlocked ? "Entblocken" : "Blockieren"}
                  </button>
                  <button onClick={() => void submitReport()} className="hover:underline">
                    Melden
                  </button>
                </div>
              )}
              {profile.isMe && (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 text-xs text-gray-500 hover:underline"
                  >
                    Profilbild ändern
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void onAvatarSelected(e)}
                  />
                </>
              )}
            </div>
          </div>

          {editing && (
            <div className={`${card} mb-6 flex flex-col gap-2`}>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Anzeigename"
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
                  Abbrechen
                </button>
                <button onClick={() => void saveProfile()} disabled={saving} className={btnPrimary}>
                  Speichern
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
              <p className="text-sm text-gray-400">Noch keine Posts.</p>
            )}
          </div>

          {nextCursor && (
            <button
              onClick={() => void loadMorePosts()}
              className="mt-4 w-full rounded border py-2 text-sm"
            >
              Weitere Beiträge laden
            </button>
          )}
        </>
      )}
    </div>
  );
}
