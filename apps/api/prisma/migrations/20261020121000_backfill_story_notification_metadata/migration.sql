UPDATE "Notification" AS notification
SET "storyId" = reaction."storyId",
    "reactionEmoji" = reaction."emoji"
FROM "StoryReaction" AS reaction
WHERE notification."type" = 'story_reaction'
  AND notification."actorId" = reaction."userId"
  AND notification."dedupeKey" = 'story-reaction:' || reaction."storyId" || ':' || reaction."userId";