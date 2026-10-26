import { z } from "zod";

const usernameSchema = z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "only letters, numbers, underscore")
    .transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  username: usernameSchema,
  password: z.string().min(8),
  inviteCode: z.string().min(32).max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const updateAccountSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  username: usernameSchema,
  currentPassword: z.string().min(1),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const checkUsernameSchema = usernameSchema;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1),
  confirmation: z.literal("DELETE"),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const POST_VISIBILITY = ["public", "close_friends", "circle"] as const;
export type PostVisibility = (typeof POST_VISIBILITY)[number];

export const MAX_CIRCLES_PER_USER = 10;
export const MAX_CIRCLE_MEMBERS = 100;

export const circleNameSchema = z.string().trim().min(1).max(30);
export const createCircleSchema = z.object({ name: circleNameSchema });
export type CreateCircleInput = z.infer<typeof createCircleSchema>;
export const updateCircleSchema = z.object({ name: circleNameSchema });
export type UpdateCircleInput = z.infer<typeof updateCircleSchema>;
export const circleMemberSchema = z.object({ username: z.string().min(1).max(50) });
export type CircleMemberInput = z.infer<typeof circleMemberSchema>;

export interface CircleSummary {
  id: string;
  name: string;
  memberCount: number;
}

export interface CircleDetail extends CircleSummary {
  members: PublicUser[];
}

export interface CircleRef {
  id: string;
  name: string;
}
export const TRANSLATION_LANGUAGE_CODES = ["de", "en", "es", "fr", "it", "pt", "nl", "pl"] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGE_CODES)[number];
export const TRANSLATION_LANGUAGES: { code: TranslationLanguage; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
];
export const translatePostSchema = z.object({
  postId: z.string().min(1),
});
export type TranslatePostInput = z.infer<typeof translatePostSchema>;
export const MEDIA_TYPES = ["image", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const createPollSchema = z.object({
  question: z.string().trim().min(1).max(180),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
}).refine((poll) => new Set(poll.options.map((option) => option.toLocaleLowerCase())).size === poll.options.length, {
  message: "Poll options must be unique",
  path: ["options"],
});
export type CreatePollInput = z.infer<typeof createPollSchema>;

export const createPostSchema = z.object({
  text: z.string().max(2000).optional(),
  imageKey: z.string().optional(),
  mediaType: z.enum(MEDIA_TYPES).optional(),
  parentPostId: z.string().optional(),
  visibility: z.enum(POST_VISIBILITY).optional(),
  circleId: z.string().min(1).optional(),
  poll: createPollSchema.optional(),
}).refine((post) => post.visibility !== "circle" || !!post.circleId, {
  message: "Choose a circle",
  path: ["circleId"],
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
  createdAt: string;
}

export interface FeedPost {
  id: string;
  author: PublicUser;
  text: string | null;
  imageKey: string | null;
  mediaType: MediaType;
  createdAt: string;
  visibility: PostVisibility;
  circle: CircleRef | null;
  parentPostId: string | null;
  pollId: string | null;
  replyCount: number;
  commentCount: number;
  factCheckCount: number;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  // true once the user has scrolled past all posts newer than their last visit
  caughtUp: boolean;
  // index within `posts` where previously-seen content starts, null if not in this page
  boundaryIndex: number | null;
}

export type FeedItem =
  | {
      type: "post";
      id: string;
      createdAt: string;
      post: FeedPost;
    }
  | {
      type: "follow";
      id: string;
      createdAt: string;
      follower: PublicUser;
      followee: PublicUser;
    }
  | {
      type: "external";
      id: string;
      createdAt: string;
      external: ExternalFeedPost;
    };

export const EXTERNAL_PLATFORMS = ["bluesky", "mastodon", "youtube", "twitch"] as const;
export type ExternalPlatform = (typeof EXTERNAL_PLATFORMS)[number];

export interface ExternalProfile {
  platform: ExternalPlatform;
  externalId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string;
}

export interface ExternalFollowSummary extends ExternalProfile {
  followId: string;
  isLive: boolean;
  lastSyncedAt: string | null;
}

export interface ExternalFeedPost {
  platform: ExternalPlatform;
  externalId: string;
  authorHandle: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  profileUrl: string;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  url: string;
  publishedAt: string;
}

export interface ExternalStoryItem {
  id: string;
  platform: "youtube" | "twitch";
  title: string;
  thumbnailUrl: string | null;
  url: string;
  authorName: string;
  authorAvatarUrl: string | null;
  live: boolean;
}

export const AI_PROVIDER_TYPES = ["openai_compatible", "anthropic"] as const;
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export const createAiProviderConfigSchema = z.object({
  label: z.string().min(1).max(50),
  type: z.enum(AI_PROVIDER_TYPES),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().min(1).optional(), // optional for local Ollama without auth
  isDefault: z.boolean().optional(),
});
export type CreateAiProviderConfigInput = z.infer<
  typeof createAiProviderConfigSchema
>;

export interface AiProviderConfigPublic {
  id: string;
  label: string;
  type: AiProviderType;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  apiKeySource: "personal" | "platform" | "missing";
  // never includes the api key
}

export const updateAiProviderConfigSchema = z.object({
  label: z.string().min(1).max(50).optional(),
  type: z.enum(AI_PROVIDER_TYPES).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  // omit to keep the existing key, pass "" to clear it, or a new value to replace it
  apiKey: z.string().optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateAiProviderConfigInput = z.infer<
  typeof updateAiProviderConfigSchema
>;

export const AI_MODES = ["factcheck", "explain", "custom"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const startAiConversationSchema = z.object({
  postId: z.string(),
  providerConfigId: z.string(),
  mode: z.enum(AI_MODES),
  // required when mode === "custom": the user's own instruction/question
  customPrompt: z.string().min(1).max(2000).optional(),
  // opt-in: only meaningful for mode === "factcheck" - include this result
  // (anonymized) in the post's public FactCheck transparency summary
  shared: z.boolean().optional(),
});
export type StartAiConversationInput = z.infer<
  typeof startAiConversationSchema
>;

export const sendAiMessageSchema = z.object({
  text: z.string().min(1).max(2000),
});
export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

export interface AiConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AiConversation {
  id: string;
  postId: string;
  mode: AiMode;
  providerLabel: string;
  messages: AiConversationMessage[];
}

export interface FactCheckSummary {
  count: number;
  // "1".. "10" exact, or "10+" once more than 10 shared results exist
  bucketLabel: string;
  summary: string | null;
}

export const createCommentSchema = z.object({
  text: z.string().max(1000),
  parentCommentId: z.string().optional(),
  imageKey: z.string().min(1).max(200).optional(),
}).refine((value) => value.text.trim().length > 0 || !!value.imageKey, {
  message: "Write something or attach a photo",
  path: ["text"],
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export interface CommentReactionSummary {
  emoji: string;
  count: number;
}

export interface Comment {
  id: string;
  author: PublicUser;
  text: string;
  imageKey: string | null;
  parentCommentId: string | null;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  /** Aggregated emoji reactions, ordered by count (desc). */
  reactions: CommentReactionSummary[];
  /** The viewer's own reaction emoji, if any. */
  myReaction: string | null;
  createdAt: string;
}

export const NOTIFICATION_TYPES = [
  "post",
  "close_friend_post",
  "follow",
  "comment",
  "comment_reply",
  "comment_like",
  "story_reaction",
  "mention",
  "message",
  "live_room",
  "call",
  "snap",
  "close_friend",
  "circle_post",
  "circle_added",
  "meetup_response",
  "meetup_update",
  "meetup_cancelled",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationPreferences {
  postsFromFollowing: boolean;
  postsFromCloseFriends: boolean;
  snaps: boolean;
  messages: boolean;
  liveRooms: boolean;
  follows: boolean;
  comments: boolean;
  commentReplies: boolean;
  commentLikes: boolean;
  storyReactions: boolean;
  mentions: boolean;
  closeFriends: boolean;
  postsFromCircles: boolean;
  circles: boolean;
  meetupResponses: boolean;
  meetupUpdates: boolean;
  quietHoursEnabled: boolean;
  // minutes after local midnight
  quietStartMinute: number;
  quietEndMinute: number;
  timezone: string;
}

export interface UserNotification {
  id: string;
  type: NotificationType;
  actor: PublicUser;
  postId: string | null;
  commentId: string | null;
  conversationId: string | null;
  snapId: string | null;
  commentText: string | null;
  storyId?: string | null;
  reactionEmoji?: string | null;
  dismissedAt?: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPage {
  notifications: UserNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

export const MAX_STORY_AUDIO_MS = 60_000;
export const MAX_VOICE_MESSAGE_MS = 120_000;

export const storyMeetupSchema = z.object({
  title: z.string().trim().max(60).optional(),
  startsAt: z.string().datetime(),
  place: z.string().trim().min(1).max(120),
});
export type StoryMeetupInput = z.infer<typeof storyMeetupSchema>;

export const updateStoryMeetupSchema = storyMeetupSchema;
export type UpdateStoryMeetupInput = z.infer<typeof updateStoryMeetupSchema>;

export const createStorySchema = z.object({
  imageKey: z.string().min(1),
  audioKey: z.string().min(1).optional(),
  audioDurationMs: z.number().int().min(500).max(MAX_STORY_AUDIO_MS).optional(),
  videoKey: z.string().min(1).optional(),
  text: z.string().max(500).optional(),
  visibility: z.enum(POST_VISIBILITY).optional(),
  circleId: z.string().min(1).optional(),
  meetup: storyMeetupSchema.optional(),
}).refine((story) => story.visibility !== "circle" || !!story.circleId, {
  message: "Choose a circle",
  path: ["circleId"],
}).refine((story) => !story.audioKey || story.audioDurationMs !== undefined, {
  message: "Audio needs a duration",
  path: ["audioDurationMs"],
}).refine((story) => !(story.audioKey && story.videoKey), {
  message: "A story can have a voice track or a video, not both",
  path: ["videoKey"],
});
export type CreateStoryInput = z.infer<typeof createStorySchema>;

export interface StoryMeetup {
  id: string;
  title: string | null;
  startsAt: string;
  place: string;
  attendeeCount: number;
  attendees: PublicUser[];
  isGoing: boolean;
  isCancelled: boolean;
}

export interface Story {
  id: string;
  viewedAt?: string | null;
  imageKey: string;
  audioKey: string | null;
  audioDurationMs: number | null;
  videoKey: string | null;
  text: string | null;
  createdAt: string;
  expiresAt: string;
  visibility: PostVisibility;
  circle: CircleRef | null;
  meetup: StoryMeetup | null;
  reactionCounts: { emoji: string; count: number }[];
  myReaction: string | null;
}

export interface StoryGroup {
  author: PublicUser;
  stories: Story[];
}

export const STORY_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮"] as const;

export const COMMENT_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮"] as const;
export type CommentReactionEmoji = (typeof COMMENT_REACTIONS)[number];
export const createStoryReactionSchema = z.object({
  emoji: z.enum(STORY_REACTIONS),
});
export type CreateStoryReactionInput = z.infer<typeof createStoryReactionSchema>;

export const votePollSchema = z.object({
  optionId: z.string().min(1),
});
export type VotePollInput = z.infer<typeof votePollSchema>;

export interface PollSummary {
  id: string;
  question: string;
  options: { id: string; text: string; voteCount: number }[];
  totalVotes: number;
  myVoteOptionId: string | null;
  isAuthor: boolean;
}

export const encryptedSnapPayloadSchema = z.object({
  version: z.literal(1),
  imageIv: z.string().length(16),
  textIv: z.string().length(16),
  encryptedText: z.string().min(24).max(3000),
  wrappedKeys: z
    .record(z.string().regex(/^[a-f0-9]{64}$/), z.string().min(1).max(2048))
    .refine((keys) => Object.keys(keys).length > 0 && Object.keys(keys).length <= 512),
});
export type EncryptedSnapPayload = z.infer<typeof encryptedSnapPayloadSchema>;

export const createSnapSchema = z.object({
  imageKey: z.string().min(1),
  text: z.string().max(500).optional(),
  encryptedPayload: encryptedSnapPayloadSchema.optional(),
  recipientUsernames: z.array(z.string()).min(1).max(50),
}).refine((data) => !(data.text !== undefined && data.encryptedPayload !== undefined));
export type CreateSnapInput = z.infer<typeof createSnapSchema>;

export const snapEncryptionKeysSchema = z.object({
  recipientUsernames: z.array(z.string().min(1)).min(1).max(50),
});
export type SnapEncryptionKeysInput = z.infer<typeof snapEncryptionKeysSchema>;

export interface InboxSnap {
  id: string;
  sender: PublicUser;
  imageKey: string;
  text: string | null;
  isEncrypted: boolean;
  encryptedPayload: EncryptedSnapPayload | null;
  createdAt: string;
  viewedAt: string | null;
}

export interface SnapStreakSummary {
  friend: PublicUser;
  currentStreak: number;
  bestStreak: number;
  lastExchangeAt: string | null;
  waitingForYou: boolean;
  waitingForThem: boolean;
  /** True between 24h and 48h after the last exchange: streak can still be saved. */
  atRisk: boolean;
}

export const LIVE_ROOM_AUDIENCES = ["invited", "close_friends", "friends", "everyone"] as const;
export type LiveRoomAudience = (typeof LIVE_ROOM_AUDIENCES)[number];
export const MAX_LIVE_ROOM_PARTICIPANTS = 16;

// Moments: one surprise capture window per day.
export const MOMENT_WINDOW_SECONDS = 180;
export const MOMENT_MEDIA_TYPES = ["image", "video"] as const;

export const createMomentPostSchema = z.object({
  imageKey: z.string().min(1).max(200),
  mediaType: z.enum(MOMENT_MEDIA_TYPES).default("image"),
  caption: z.string().trim().max(200).optional(),
});
export type CreateMomentPostInput = z.infer<typeof createMomentPostSchema>;

export interface MomentPostItem {
  id: string;
  user: PublicUser;
  imageKey: string;
  mediaType: (typeof MOMENT_MEDIA_TYPES)[number];
  caption: string | null;
  late: boolean;
  lateBySeconds: number;
  createdAt: string;
  reactions?: { emoji: string; user: PublicUser }[];
}

// "waiting": the time is still a secret; "open": inside the on-time window; "late": window over, posting still allowed today.
export interface MomentSummary {
  status: "none" | "waiting" | "open" | "late";
  momentId?: string | null;
  previousMoment?: boolean;
  serverNow: string;
  startsAt: string | null;
  windowEndsAt: string | null;
  myPost: MomentPostItem | null;
  currentStreak: number;
  bestStreak: number;
}

export interface MomentFeed {
  locked: boolean;
  friendPostCount: number;
  posts: MomentPostItem[];
}

export const MUSIC_PROVIDERS = ["spotify", "apple_music", "soundcloud"] as const;
export type MusicProvider = (typeof MUSIC_PROVIDERS)[number];

export const setNowPlayingSchema = z.object({
  provider: z.enum(MUSIC_PROVIDERS),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120),
  url: z.string().url().max(2048),
  links: z.object({ spotify: z.string().url().max(2048), apple_music: z.string().url().max(2048), soundcloud: z.string().url().max(2048).optional() }).optional(),
});
export type SetNowPlayingInput = z.infer<typeof setNowPlayingSchema>;

export interface MusicNowPlaying {
  id: string;
  provider: MusicProvider;
  title: string;
  artist: string;
  url: string;
  links?: { spotify: string; apple_music: string; soundcloud?: string };
  updatedAt: string;
  user: PublicUser;
}

export const musicTrackSchema = z.object({
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().max(120).default(""),
  startMs: z.number().int().min(0).max(10_800_000),
});
export type MusicTrack = z.infer<typeof musicTrackSchema>;

export const createMusicMixSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  audioKey: z.string().min(1).max(200),
  durationMs: z.number().int().min(30_000).max(10_800_000),
  waveform: z.array(z.number().min(0).max(1)).min(16).max(256),
  tracklist: z.array(musicTrackSchema).max(80),
}).refine((mix) => mix.tracklist.every((track) => track.startMs < mix.durationMs), {
  message: "Track markers must be within the mix duration",
  path: ["tracklist"],
});
export type CreateMusicMixInput = z.infer<typeof createMusicMixSchema>;

export const createMusicMixCommentSchema = z.object({
  timestampMs: z.number().int().min(0).max(10_800_000),
  text: z.string().trim().min(1).max(500),
});
export type CreateMusicMixCommentInput = z.infer<typeof createMusicMixCommentSchema>;

export const updateMusicTasteSchema = z.object({
  genres: z.array(z.string().trim().min(1).max(40)).max(20),
  favoriteTracks: z.array(z.string().trim().min(1).max(160)).max(20),
}).strict();
export type UpdateMusicTasteInput = z.infer<typeof updateMusicTasteSchema>;

export interface MusicTaste {
  genres: string[];
  favoriteTracks: string[];
}

export interface MusicTasteMatch {
  score: number;
  sharedGenres: string[];
  sharedTracks: string[];
}

export interface MusicMixComment {
  id: string;
  timestampMs: number;
  text: string;
  createdAt: string;
  user: PublicUser;
}

export interface MusicMix {
  id: string;
  title: string;
  description: string | null;
  audioKey: string;
  durationMs: number;
  waveform: number[];
  tracklist: MusicTrack[];
  createdAt: string;
  owner: PublicUser;
  commentCount: number;
}

export interface RadioRoom {
  radioId: string;
  mixId: string;
  mix: MusicMix;
  title: string;
  hostUserId: string;
  audience: LiveRoomAudience;
  participantIds: string[];
  members: PublicUser[];
  isPlaying: boolean;
  positionMs: number;
  syncedAt: string;
}

export interface RadioMessage {
  id: string;
  radioId: string;
  user: PublicUser;
  kind: "text" | "emoji";
  content: string;
  createdAt: string;
}

export interface LiveRoom {
  callId: string;
  conversationId: string;
  title: string;
  hostUserId: string;
  audience: LiveRoomAudience;
  participantIds: string[];
  members: PublicUser[];
}

export interface UsageMetricCounts {
  users: number;
  posts: number;
  stories: number;
  snaps: number;
  moments: number;
  messages: number;
  comments: number;
  follows: number;
}

export interface PublicUsageMetrics {
  asOf: string;
  trackingSince: string;
  last24Hours: UsageMetricCounts;
  last7Days: UsageMetricCounts;
  total: UsageMetricCounts;
}

export const encryptedMessagePayloadSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(16).max(32),
  ciphertext: z.string().min(1).max(12000),
  wrappedKeys: z
    .record(z.string().regex(/^[a-f0-9]{64}$/), z.string().min(1).max(2048))
    .refine((keys) => Object.keys(keys).length > 0 && Object.keys(keys).length <= 500),
});
export type EncryptedMessagePayload = z.infer<typeof encryptedMessagePayloadSchema>;

export const sendMessageSchema = z.union([
  z.object({ text: z.string().min(1).max(4000), mediaKey: z.string().min(1).optional() }).strict(),
  z.object({ encryptedPayload: encryptedMessagePayloadSchema, mediaKey: z.string().min(1).optional(), storyId: z.string().min(1).optional() }).strict(),
]);
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const registerEncryptionKeySchema = z.object({
  publicKey: z.string().min(300).max(1000),
});
export type RegisterEncryptionKeyInput = z.infer<typeof registerEncryptionKeySchema>;

export const startConversationSchema = z.object({
  username: z.string().min(1),
});
export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const createGroupConversationSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  usernames: z.array(z.string()).max(50),
  allowEmpty: z.boolean().optional(),
});
export type CreateGroupConversationInput = z.infer<
  typeof createGroupConversationSchema
>;

export interface ConversationSummary {
  id: string;
  name: string | null;
  isGroup: boolean;
  members: PublicUser[];
  otherMember: PublicUser | null;
  unreadCount: number;
  lastMessage: {
    text: string | null;
    isEncrypted: boolean;
    createdAt: string;
    senderId: string;
  } | null;
}

export interface ConversationMessage {
  id: string;
  callId?: string | null;
  senderId: string;
  text: string | null;
  isEncrypted: boolean;
  encryptedPayload: EncryptedMessagePayload | null;
  createdAt: string;
  // ciphertext attachment of a voice message
  mediaKey?: string | null;
  // sender-visible transport state; pending is local-only in the web app.
  deliveryState?: "pending" | "sent" | "delivered" | "read";
}

export interface ConversationMessagesPage {
  messages: ConversationMessage[];
  nextCursor: string | null;
}

export interface UserProfile extends PublicUser {
  bio: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isFollowedByMe: boolean;
  isMe: boolean;
}

export const updateProfileSchema = z.object({
  displayName: z.string().max(60).optional(),
  bio: z.string().max(280).optional(),
  avatarKey: z.string().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const REPORT_TARGET_TYPES = ["post", "user"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string(),
  reason: z.string().min(1).max(500),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export * from "./safetyNumber.js";
export * from "./hashtags.js";
