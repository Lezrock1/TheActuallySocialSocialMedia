import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { btnPrimary, card } from "../lib/ui.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PushNotificationSettings from "../components/PushNotificationSettings.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";

const sections: {
  title: string;
  options: { key: keyof NotificationPreferences; label: string; description: string }[];
}[] = [
  {
    title: "Posts",
    options: [
      { key: "postsFromFollowing", label: "People you follow", description: "New public posts from people you follow." },
      { key: "postsFromCloseFriends", label: "Close friends", description: "Posts shared with their close-friends list." },
    ],
  },
  {
    title: "Direct",
    options: [
      { key: "snaps", label: "Snaps", description: "New Snaps sent to you." },
      { key: "messages", label: "Messages", description: "New direct and group messages." },
      { key: "liveRooms", label: "Live Rooms", description: "When a room you can join goes live." },
    ],
  },
  {
    title: "Other alerts",
    options: [
      { key: "follows", label: "New followers", description: "When someone follows you." },
      { key: "comments", label: "Comments", description: "New comments on your posts." },
      { key: "commentReplies", label: "Comment replies", description: "Replies to your comments." },
      { key: "commentLikes", label: "Comment likes", description: "When someone likes your comment." },
      { key: "storyReactions", label: "Story reactions", description: "When someone reacts to your story." },
      { key: "mentions", label: "Mentions", description: "When someone mentions you." },
      { key: "closeFriends", label: "Close Friends updates", description: "When someone adds you to their close-friends list." },
    ],
  },
];

async function fetchPreferences(): Promise<NotificationPreferences> {
  const result = await apiFetch<{ preferences: NotificationPreferences }>("/notifications/preferences");
  return result.preferences;
}

export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: fetchPreferences,
  });
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preferencesQuery.data) setDraft(preferencesQuery.data);
  }, [preferencesQuery.data]);

  const hasChanges = !!draft && !!preferencesQuery.data &&
    Object.keys(draft).some((key) =>
      draft[key as keyof NotificationPreferences] !== preferencesQuery.data[key as keyof NotificationPreferences]
    );

  function togglePreference(key: keyof NotificationPreferences, enabled: boolean) {
    setSaved(false);
    setDraft((current) => current ? { ...current, [key]: enabled } : current);
  }

  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !hasChanges) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiFetch<{ preferences: NotificationPreferences }>("/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      setDraft(result.preferences);
      queryClient.setQueryData(["notification-preferences"], result.preferences);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save notification settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Notifications" />
      <NavBar />
      <p className="mb-4 text-sm leading-5 text-gray-500">
        Choose which new activity creates an in-app alert and a phone notification. Existing alerts stay in your history.
      </p>
      <PushNotificationSettings />
      {preferencesQuery.isLoading && <CardListSkeleton rows={2} />}
      {preferencesQuery.isError && <p role="alert" className="py-4 text-sm text-red-600">Could not load notification settings.</p>}
      {draft && (
        <form onSubmit={(event) => void savePreferences(event)}>
          <div className={card}>
            {sections.map((section, sectionIndex) => (
              <section key={section.title} aria-labelledby={`notification-section-${sectionIndex}`} className={sectionIndex ? "border-t border-gray-100 pt-4 mt-4" : ""}>
                <h2 id={`notification-section-${sectionIndex}`} className="mb-2 text-sm font-semibold text-gray-900">{section.title}</h2>
                <div className="divide-y divide-gray-100">
                  {section.options.map((option) => (
                    <label key={option.key} htmlFor={`preference-${option.key}`} className="flex cursor-pointer items-center gap-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-800">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-gray-500">{option.description}</span>
                      </span>
                      <input
                        id={`preference-${option.key}`}
                        type="checkbox"
                        checked={draft[option.key]}
                        onChange={(event) => togglePreference(option.key, event.target.checked)}
                        className="h-5 w-5 shrink-0 accent-[#1D9BF0]"
                      />
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          {saved && <p role="status" className="mt-3 text-sm text-green-700">Notification settings saved.</p>}
          <button type="submit" disabled={!hasChanges || saving} className={`${btnPrimary} mt-4 min-h-11 w-full disabled:cursor-not-allowed`}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}
    </div>
  );
}