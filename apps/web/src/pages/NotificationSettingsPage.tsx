import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { btnPrimary, card } from "../lib/ui.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PushNotificationSettings from "../components/PushNotificationSettings.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";

type BooleanPreferenceKey = {
  [K in keyof NotificationPreferences]: NotificationPreferences[K] extends boolean ? K : never;
}[keyof NotificationPreferences];

const sections: {
  title: string;
  options: { key: BooleanPreferenceKey; label: string; description: string }[];
}[] = [
  {
    title: "Posts",
    options: [
      { key: "postsFromFollowing", label: "People you follow", description: "New public posts from people you follow." },
      { key: "postsFromCloseFriends", label: "Close friends", description: "Posts shared with their close-friends list." },
      { key: "postsFromCircles", label: "Circles", description: "Posts shared with a circle you're in." },
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
      { key: "circles", label: "Circle invites", description: "When someone adds you to one of their circles." },
      { key: "meetupResponses", label: "Meetup answers", description: "When someone says \"I'm in\" to your story meetup." },
      { key: "meetupUpdates", label: "Meetup changes", description: "When a story meetup you joined changes or is cancelled." },
    ],
  },
];

async function fetchPreferences(): Promise<NotificationPreferences> {
  const result = await apiFetch<{ preferences: NotificationPreferences }>("/notifications/preferences");
  return result.preferences;
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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

  function togglePreference(key: BooleanPreferenceKey, enabled: boolean) {
    setSaved(false);
    setDraft((current) => current ? { ...current, [key]: enabled } : current);
  }

  function updateQuiet(changes: Partial<Pick<NotificationPreferences, "quietHoursEnabled" | "quietStartMinute" | "quietEndMinute" | "timezone">>) {
    setSaved(false);
    setDraft((current) => current ? { ...current, timezone: browserTimeZone(), ...changes } : current);
  }

  const quietInvalid = !!draft && draft.quietHoursEnabled && draft.quietStartMinute === draft.quietEndMinute;

  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !hasChanges || quietInvalid) return;
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
          <section aria-labelledby="quiet-hours-title" className={`${card} mb-4`}>
            <label htmlFor="quiet-hours-enabled" className="flex cursor-pointer items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span id="quiet-hours-title" className="block text-sm font-semibold text-gray-900">Quiet hours</span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                  Pause phone notifications. Afterwards you get one summary of what you missed.
                </span>
              </span>
              <input
                id="quiet-hours-enabled"
                type="checkbox"
                checked={draft.quietHoursEnabled}
                onChange={(event) => updateQuiet({ quietHoursEnabled: event.target.checked })}
                className="h-5 w-5 shrink-0 accent-[#1D9BF0]"
              />
            </label>
            {draft.quietHoursEnabled && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                    From
                    <input
                      type="time"
                      value={minutesToTime(draft.quietStartMinute)}
                      onChange={(event) => {
                        const minutes = timeToMinutes(event.target.value);
                        if (minutes !== null) updateQuiet({ quietStartMinute: minutes });
                      }}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-[#007AFF] focus:outline-none focus:ring-4 focus:ring-[#007AFF]/10"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                    Until
                    <input
                      type="time"
                      value={minutesToTime(draft.quietEndMinute)}
                      onChange={(event) => {
                        const minutes = timeToMinutes(event.target.value);
                        if (minutes !== null) updateQuiet({ quietEndMinute: minutes });
                      }}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-[#007AFF] focus:outline-none focus:ring-4 focus:ring-[#007AFF]/10"
                    />
                  </label>
                </div>
                {quietInvalid ? (
                  <p role="alert" className="mt-2 text-xs text-red-600">Start and end must be different.</p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-gray-500">
                    Every day from {minutesToTime(draft.quietStartMinute)} to {minutesToTime(draft.quietEndMinute)} ({browserTimeZone()}). Alerts still appear in the app.
                  </p>
                )}
              </div>
            )}
          </section>
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