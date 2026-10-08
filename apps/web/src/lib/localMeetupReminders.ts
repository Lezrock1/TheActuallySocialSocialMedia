import type { StoryGroup } from "@app/shared";
import { apiFetch } from "./api.js";

export interface LocalMeetupReminder {
  meetupId: string;
  startsAt: string;
  minutesBefore: number;
  targetUrl: string;
  notified: boolean;
  storyId?: string;
  conversationId?: string;
}

const STORAGE_PREFIX = "intouch-local-meetup-reminders:v1:";
const ALLOWED_MINUTES = new Set([5, 15, 60, 1440]);

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function read(userId: string): LocalMeetupReminder[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LocalMeetupReminder =>
      !!item && typeof item === "object" &&
      typeof (item as LocalMeetupReminder).meetupId === "string" &&
      typeof (item as LocalMeetupReminder).startsAt === "string" &&
      typeof (item as LocalMeetupReminder).minutesBefore === "number" &&
      typeof (item as LocalMeetupReminder).targetUrl === "string" &&
      typeof (item as LocalMeetupReminder).notified === "boolean"
    );
  } catch {
    return [];
  }
}

function write(userId: string, reminders: LocalMeetupReminder[]): boolean {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(reminders));
    return true;
  } catch {
    return false;
  }
}

export function getLocalMeetupReminderMinutes(userId: string, meetupId: string): number | null {
  return read(userId).find((reminder) => reminder.meetupId === meetupId)?.minutesBefore ?? null;
}

// Reminder details stay in this browser; no meetup time/title/place is sent to the server.
export async function setLocalMeetupReminder(
  userId: string,
  meetupId: string,
  startsAt: string,
  minutesBefore: number | null,
  targetUrl: string,
  storyId?: string,
  conversationId?: string
): Promise<string | null> {
  if (minutesBefore === null) {
    write(userId, read(userId).filter((reminder) => reminder.meetupId !== meetupId));
    return null;
  }
  if (!ALLOWED_MINUTES.has(minutesBefore)) return "Choose a supported reminder time.";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return "This browser cannot show local reminders.";
  }
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return "Notifications could not be enabled on this device.";
    }
  }
  if (permission !== "granted") return "Allow notifications to use a reminder on this device.";

  const current = read(userId).filter((reminder) => reminder.meetupId !== meetupId);
  current.push({
    meetupId,
    startsAt,
    minutesBefore,
    targetUrl,
    notified: false,
    ...(storyId ? { storyId } : {}),
    ...(conversationId ? { conversationId } : {}),
  });
  if (!write(userId, current)) return "This browser cannot store a reminder on this device.";
  return null;
}

export function clearLocalMeetupReminder(userId: string, meetupId: string): void {
  write(userId, read(userId).filter((reminder) => reminder.meetupId !== meetupId));
}

export function syncLocalChatMeetupReminders(
  userId: string,
  conversationId: string,
  states: Map<string, { startsAt: string; status: "active" | "cancelled" }>
): boolean {
  const reminders = read(userId);
  let changed = false;
  const remaining = reminders.filter((reminder) => {
    if (reminder.conversationId !== conversationId) return true;
    const current = states.get(reminder.meetupId);
    if (!current) return true;
    if (current.status === "cancelled") {
      changed = true;
      return false;
    }
    if (current.startsAt !== reminder.startsAt) {
      reminder.startsAt = current.startsAt;
      reminder.notified = false;
      changed = true;
    }
    return true;
  });
  if (changed) write(userId, remaining);
  return changed;
}

export async function deliverDueMeetupReminders(userId: string, now = Date.now()): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reminders = read(userId);
  if (!reminders.length) return;
  let changed = false;
  let storySyncSucceeded = true;

  const storyReminders = reminders.filter((reminder) => {
    if (!reminder.storyId || reminder.notified) return false;
    const startsAt = new Date(reminder.startsAt).getTime();
    const notifyAt = startsAt - reminder.minutesBefore * 60_000;
    return Number.isFinite(notifyAt) && notifyAt <= now + 60_000;
  });
  if (storyReminders.length > 0) {
    try {
      const { groups } = await apiFetch<{ groups: StoryGroup[] }>("/stories");
      const currentMeetups = new Map(groups.flatMap((group) => group.stories)
        .filter((story) => story.meetup)
        .map((story) => [story.meetup!.id, { startsAt: story.meetup!.startsAt, cancelled: story.meetup!.isCancelled }]));
      for (const reminder of storyReminders) {
        const current = currentMeetups.get(reminder.meetupId);
        if (!current || current.cancelled) {
          if (!reminder.notified) {
            reminder.notified = true;
            changed = true;
          }
        } else if (current.startsAt !== reminder.startsAt) {
          reminder.startsAt = current.startsAt;
          reminder.notified = false;
          changed = true;
        }
      }
    } catch {
      storySyncSucceeded = false;
    }
  }
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!registration) {
    if (changed) write(userId, reminders);
    return;
  }

  for (const reminder of reminders) {
    if (reminder.storyId && !storySyncSucceeded) continue;
    const startsAt = new Date(reminder.startsAt).getTime();
    const notifyAt = startsAt - reminder.minutesBefore * 60_000;
    if (reminder.notified || !Number.isFinite(startsAt) || now < notifyAt) continue;
    if (now > startsAt + 2 * 60 * 60_000) {
      reminder.notified = true;
      changed = true;
      continue;
    }
    await registration.showNotification("Meetup reminder", {
      body: "A meetup you saved is coming up.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: `local-meetup:${reminder.meetupId}`,
      data: { url: reminder.targetUrl },
    });
    reminder.notified = true;
    changed = true;
  }
  const active = reminders.filter((reminder) => !reminder.notified || now < new Date(reminder.startsAt).getTime() + 2 * 60 * 60_000);
  if (changed || active.length !== reminders.length) write(userId, active);
}
