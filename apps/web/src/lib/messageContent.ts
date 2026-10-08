// Structured chat payloads travel inside the (end-to-end encrypted) message text as JSON.
export interface StoryReplyContext {
  storyId: string;
  imageKey: string;
  authorUsername: string;
  createdAt: string;
}

export interface VoiceContent {
  mediaKey: string;
  // base64 AES-GCM key and IV for the uploaded ciphertext
  key: string;
  iv: string;
  durationMs: number;
  peaks: number[];
}

export interface MeetupContent {
  id: string;
  title: string;
  startsAt: string;
  place: string;
  note: string;
}

export type ParsedMessage =
  | { kind: "text"; text: string; storyReply?: StoryReplyContext }
  | { kind: "voice"; voice: VoiceContent }
  | { kind: "meetup"; meetup: MeetupContent }
  | { kind: "rsvp"; meetupId: string; going: boolean };

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function parseMessageContent(content: string): ParsedMessage {
  if (!content.startsWith("{")) return { kind: "text", text: content };
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (value.type === "story_reply" && isString(value.text)) {
      const story = value.story as Partial<StoryReplyContext> | undefined;
      if (isString(story?.storyId) && isString(story.imageKey) && isString(story.authorUsername)) {
        return {
          kind: "text",
          text: value.text,
          storyReply: {
            storyId: story.storyId,
            imageKey: story.imageKey,
            authorUsername: story.authorUsername,
            createdAt: isString(story.createdAt) ? story.createdAt : "",
          },
        };
      }
    }
    if (value.type === "voice") {
      const voice = value.voice as Partial<VoiceContent> | undefined;
      if (
        isString(voice?.mediaKey) && isString(voice.key) && isString(voice.iv) &&
        typeof voice.durationMs === "number" && Array.isArray(voice.peaks)
      ) {
        return {
          kind: "voice",
          voice: {
            mediaKey: voice.mediaKey,
            key: voice.key,
            iv: voice.iv,
            durationMs: voice.durationMs,
            peaks: voice.peaks.filter((peak): peak is number => typeof peak === "number").slice(0, 80),
          },
        };
      }
    }
    if (value.type === "meetup") {
      const meetup = value.meetup as Partial<MeetupContent> | undefined;
      if (isString(meetup?.id) && isString(meetup.startsAt) && isString(meetup.place)) {
        return {
          kind: "meetup",
          meetup: {
            id: meetup.id,
            title: isString(meetup.title) ? meetup.title : "",
            startsAt: meetup.startsAt,
            place: meetup.place,
            note: isString(meetup.note) ? meetup.note : "",
          },
        };
      }
    }
    if (value.type === "meetup_rsvp" && isString(value.meetupId) && typeof value.going === "boolean") {
      return { kind: "rsvp", meetupId: value.meetupId, going: value.going };
    }
  } catch {
    // Ordinary messages are plain text rather than structured JSON.
  }
  return { kind: "text", text: content };
}

export const buildVoiceContent = (voice: VoiceContent) => JSON.stringify({ type: "voice", voice });
export const buildMeetupContent = (meetup: MeetupContent) => JSON.stringify({ type: "meetup", meetup });
export const buildRsvpContent = (meetupId: string, going: boolean) =>
  JSON.stringify({ type: "meetup_rsvp", meetupId, going });

export interface MeetupAttendance {
  // sender ids that are currently "I'm in"
  goingUserIds: string[];
}

// The latest RSVP of each sender wins; messages must be in chronological order.
export function computeMeetupAttendance(
  entries: { senderId: string; parsed: ParsedMessage }[]
): Map<string, MeetupAttendance> {
  const latest = new Map<string, Map<string, boolean>>();
  for (const { senderId, parsed } of entries) {
    if (parsed.kind !== "rsvp") continue;
    const bySender = latest.get(parsed.meetupId) ?? new Map<string, boolean>();
    bySender.set(senderId, parsed.going);
    latest.set(parsed.meetupId, bySender);
  }
  const result = new Map<string, MeetupAttendance>();
  for (const [meetupId, bySender] of latest) {
    result.set(meetupId, {
      goingUserIds: [...bySender].filter(([, going]) => going).map(([senderId]) => senderId),
    });
  }
  return result;
}
