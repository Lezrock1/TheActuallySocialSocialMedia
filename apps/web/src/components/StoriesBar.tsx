import { useEffect, useRef, useState } from "react";
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
  const [storyIndex, setStoryIndex] = useState(0);
  const [visibility, setVisibility] = useState<PostVisibility>("public");

  const { data: groups = [] } = useQuery({
    queryKey: ["stories"],
    queryFn: fetchStoryGroups,
  });

  const viewingGroupIndex = viewing
    ? groups.findIndex((group) => group.author.id === viewing.author.id)
    : -1;

  useEffect(() => {
    if (!viewing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setViewing(null);
      if (event.key === "ArrowRight") advanceStory(1);
      if (event.key === "ArrowLeft") advanceStory(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewing, storyIndex, groups]);

  function advanceStory(direction: -1 | 1) {
    if (!viewing) return;
    const nextStoryIndex = storyIndex + direction;
    if (nextStoryIndex >= 0 && nextStoryIndex < viewing.stories.length) {
      setStoryIndex(nextStoryIndex);
      return;
    }

    const nextGroup = groups[viewingGroupIndex + direction];
    if (!nextGroup) {
      setViewing(null);
      return;
    }
    setViewing(nextGroup);
    setStoryIndex(direction > 0 ? 0 : nextGroup.stories.length - 1);
  }

  function openStoryGroup(group: StoryGroup) {
    setViewing(group);
    setStoryIndex(0);
  }

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
        <span>New story visible to</span>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as PostVisibility)}
          className="rounded-md border border-gray-200 px-1.5 py-0.5"
        >
          <option value="public">All followers</option>
          <option value="close_friends">Close friends only</option>
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
            onClick={() => openStoryGroup(group)}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-3"
          role="dialog"
          aria-modal="true"
          aria-label={`Stories from @${viewing.author.username}`}
          onClick={() => setViewing(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-lg bg-black"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex gap-1 px-3 pt-3" aria-label={`Story ${storyIndex + 1} of ${viewing.stories.length}`}>
              {viewing.stories.map((story, index) => (
                <span key={story.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                  {index <= storyIndex && <span className="block h-full bg-white" />}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between px-3 py-3 text-sm font-medium text-white">
              <span className="flex items-center gap-2">
                <Avatar avatarKey={viewing.author.avatarKey} username={viewing.author.username} size={30} />
                @{viewing.author.username}
              </span>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Close stories"
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-white/80 hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>
            <div className="relative flex aspect-[9/16] max-h-[75vh] w-full items-center justify-center bg-gray-950">
              <img
                src={mediaUrl(viewing.stories[storyIndex].imageKey)}
                alt={`Story ${storyIndex + 1} from @${viewing.author.username}`}
                className="h-full w-full object-contain"
              />
              <button
                type="button"
                onClick={() => advanceStory(-1)}
                aria-label="Previous story"
                className="absolute inset-y-0 left-0 w-1/2"
              />
              <button
                type="button"
                onClick={() => advanceStory(1)}
                aria-label="Next story"
                className="absolute inset-y-0 right-0 w-1/2"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
