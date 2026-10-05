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

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const POST_VISIBILITY = ["public", "close_friends"] as const;
export type PostVisibility = (typeof POST_VISIBILITY)[number];

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
  parentPostId: z.string().optional(),
  visibility: z.enum(POST_VISIBILITY).optional(),
  poll: createPollSchema.optional(),
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
  createdAt: string;
  visibility: PostVisibility;
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
    };

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
  text: z.string().min(1).max(1000),
  parentCommentId: z.string().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export interface Comment {
  id: string;
  author: PublicUser;
  text: string;
  parentCommentId: string | null;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
}

export const NOTIFICATION_TYPES = [
  "post",
  "close_friend_post",
  "follow",
  "comment",
  "comment_reply",
  "comment_like",
  "mention",
  "message",
  "snap",
  "close_friend",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationPreferences {
  postsFromFollowing: boolean;
  postsFromCloseFriends: boolean;
  snaps: boolean;
  messages: boolean;
  follows: boolean;
  comments: boolean;
  commentReplies: boolean;
  commentLikes: boolean;
  mentions: boolean;
  closeFriends: boolean;
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
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPage {
  notifications: UserNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

export const createStorySchema = z.object({
  imageKey: z.string().min(1),
  visibility: z.enum(POST_VISIBILITY).optional(),
});
export type CreateStoryInput = z.infer<typeof createStorySchema>;

export interface Story {
  id: string;
  imageKey: string;
  createdAt: string;
  expiresAt: string;
  visibility: PostVisibility;
  reactionCounts: { emoji: string; count: number }[];
  myReaction: string | null;
}

export interface StoryGroup {
  author: PublicUser;
  stories: Story[];
}

export const STORY_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮"] as const;
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
  z.object({ text: z.string().min(1).max(4000) }).strict(),
  z.object({ encryptedPayload: encryptedMessagePayloadSchema }).strict(),
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
  usernames: z.array(z.string()).min(1).max(50),
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
  senderId: string;
  text: string | null;
  isEncrypted: boolean;
  encryptedPayload: EncryptedMessagePayload | null;
  createdAt: string;
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
