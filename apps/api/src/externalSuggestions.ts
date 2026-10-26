import type { ExternalPlatform, ExternalSuggestionTopic } from "@app/shared";

export interface SuggestionEntry {
  handle: string;
  topics: readonly ExternalSuggestionTopic[];
  /** If set, only users with one of these preferred languages see this entry. */
  langs?: readonly string[];
}

const T = {
  trending: "trending",
  politics: "politics",
  news: "news",
  sports: "sports",
  comedy: "comedy",
  gaming: "gaming",
  music: "music",
  tech: "tech",
  science: "science",
  art: "art",
} as const;

/**
 * Curated profiles per platform. Entries resolve live against the platform on
 * each request, so handles that no longer exist are filtered out gracefully.
 */
const SUGGESTIONS: Record<ExternalPlatform, SuggestionEntry[]> = {
  bluesky: [
    { handle: "hankgreen.bsky.social", topics: [T.trending, T.science, T.comedy] },
    { handle: "markhamillofficial.bsky.social", topics: [T.trending, T.comedy] },
    { handle: "dril.com", topics: [T.comedy, T.trending] },
    { handle: "weratedogs.com", topics: [T.comedy, T.trending] },
    { handle: "dieworkwear.bsky.social", topics: [T.comedy] },
    { handle: "aoc.bsky.social", topics: [T.politics] },
    { handle: "georgetakei.com", topics: [T.politics, T.comedy] },
    { handle: "rbreich.bsky.social", topics: [T.politics] },
    { handle: "nytimes.com", topics: [T.news] },
    { handle: "washingtonpost.com", topics: [T.news] },
    { handle: "theguardian.com", topics: [T.news] },
    { handle: "bleacherreport.com", topics: [T.sports] },
    { handle: "sbnation.com", topics: [T.sports] },
    { handle: "ign.com", topics: [T.gaming] },
    { handle: "gamespot.com", topics: [T.gaming] },
    { handle: "theverge.com", topics: [T.tech] },
    { handle: "techcrunch.com", topics: [T.tech] },
    { handle: "nasa.gov", topics: [T.science] },
    { handle: "rollingstone.com", topics: [T.music] },
    { handle: "billboard.com", topics: [T.music] },
    { handle: "tagesschau.de", topics: [T.news], langs: ["de"] },
    { handle: "derstandard.at", topics: [T.news, T.politics], langs: ["de"] },
  ],
  mastodon: [
    { handle: "molly0xfff@hachyderm.io", topics: [T.trending, T.tech] },
    { handle: "feditips@mstdn.social", topics: [T.trending, T.tech] },
    { handle: "GeorgeTakei@universeodon.com", topics: [T.politics, T.comedy] },
    { handle: "eff@mastodon.social", topics: [T.tech, T.politics] },
    { handle: "curator@mastodon.art", topics: [T.art] },
    { handle: "gutjahr@social.tchncs.de", topics: [T.news, T.tech], langs: ["de"] },
  ],
  youtube: [
    { handle: "kurzgesagt", topics: [T.trending, T.science] },
    { handle: "markrober", topics: [T.trending, T.science, T.comedy] },
    { handle: "mrbeast", topics: [T.trending, T.gaming] },
    { handle: "dailydoseofinternet", topics: [T.trending, T.comedy] },
    { handle: "veritasium", topics: [T.science] },
    { handle: "mkbhd", topics: [T.tech] },
    { handle: "vox", topics: [T.news] },
    { handle: "lastweektonight", topics: [T.politics, T.comedy] },
    { handle: "espn", topics: [T.sports] },
    { handle: "markiplier", topics: [T.gaming] },
    { handle: "nprmusic", topics: [T.music] },
    { handle: "simonegiertz", topics: [T.comedy, T.tech] },
    { handle: "proko", topics: [T.art] },
    { handle: "helddersteine", topics: [T.trending, T.comedy], langs: ["de"] },
    { handle: "mrwissen2go", topics: [T.news, T.politics], langs: ["de"] },
    { handle: "mailab", topics: [T.science], langs: ["de"] },
    { handle: "spacefrogs", topics: [T.comedy], langs: ["de"] },
    { handle: "handofblood", topics: [T.gaming], langs: ["de"] },
    { handle: "pietsmiet", topics: [T.gaming], langs: ["de"] },
    { handle: "ultralativ", topics: [T.news, T.politics], langs: ["de"] },
    { handle: "heuteshow", topics: [T.politics, T.comedy], langs: ["de"] },
  ],
  twitch: [
    { handle: "kitboga", topics: [T.trending, T.comedy] },
    { handle: "criticalrole", topics: [T.gaming] },
    { handle: "shroud", topics: [T.gaming] },
    { handle: "xqc", topics: [T.trending, T.gaming] },
    { handle: "hasanabi", topics: [T.politics] },
    { handle: "ludwig", topics: [T.trending, T.comedy] },
    { handle: "papaplatte", topics: [T.trending, T.gaming], langs: ["de"] },
    { handle: "montanablack88", topics: [T.trending], langs: ["de"] },
    { handle: "trymacs", topics: [T.gaming, T.sports], langs: ["de"] },
    { handle: "eligella", topics: [T.comedy], langs: ["de"] },
  ],
};

/**
 * Curated suggestions for a topic, language-aware: localized entries are only
 * shown to users with a matching preferred language and are sorted first.
 */
export function suggestionEntries(
  platform: ExternalPlatform,
  topic: ExternalSuggestionTopic,
  lang: string
): SuggestionEntry[] {
  return SUGGESTIONS[platform]
    .filter((entry) => entry.topics.includes(topic))
    .filter((entry) => !entry.langs || entry.langs.includes(lang))
    .sort((a, b) => Number(Boolean(b.langs)) - Number(Boolean(a.langs)));
}
