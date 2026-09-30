import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostVisibility, StoryGroup } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import Avatar from "./Avatar.js";

async function fetchStoryGroups(): Promise<StoryGroup[]> {
  const res = await apiFetch<{ groups: StoryGroup[] }>("/stories");
  return res.groups;
}

export default function StoriesBar() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [visibility, setVisibility] = useState<PostVisibility>("public");

  const { data: groups = [] } = useQuery({
    queryKey: ["stories"],
    queryFn: fetchStoryGroups,
  });

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const imageKey = await uploadMedia(file);
      await apiFetch("/stories", {
        method: "POST",
        body: JSON.stringify({ imageKey, visibility }),
      });
      await queryClient.invalidateQueries({ queryKey: ["stories"] });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
        <span>Neue Story sichtbar für</span>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as PostVisibility)}
          className="rounded-md border border-gray-200 px-1.5 py-0.5"
        >
          <option value="public">Alle Follower</option>
          <option value="close_friends">Nur enge Freunde</option>
        </select>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex shrink-0 flex-col items-center gap-1 disabled:opacity-50"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-xl text-gray-400">
            {uploading ? "…" : "+"}
          </span>
          <span className="text-[11px] text-gray-500">Story</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFileSelected(e)}
        />
        {groups.map((group) => (
          <button
            key={group.author.id}
            onClick={() => setViewing(group)}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <span className="rounded-full bg-gradient-to-br from-gray-700 to-gray-900 p-0.5">
              <span className="block rounded-full border-2 border-white">
                <Avatar avatarKey={group.stories[0].imageKey} username={group.author.username} size={52} />
              </span>
            </span>
            <span className="max-w-[60px] truncate text-[11px] text-gray-600">@{group.author.username}</span>
          </button>
        ))}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setViewing(null)}
        >
          <div className="max-h-[80vh] max-w-md">
            <p className="mb-2 text-center text-white">
              @{viewing.author.username}
            </p>
            {viewing.stories.map((story) => (
              <img
                key={story.id}
                src={mediaUrl(story.imageKey)}
                alt=""
                className="mb-2 w-full rounded"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
