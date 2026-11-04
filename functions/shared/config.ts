/**
 * Every literal shared between the Lambdas and the CDK app. Pure module: no
 * AWS imports, so infra/ can import it at synth time.
 */

export const T_STORIES = "distributr-stories";
export const T_SUBMISSIONS = "distributr-submissions";
export const T_CONTROL = "distributr-control";
export const GSI_BY_CATEGORY = "byCategory";
export const GSI_BY_RECENCY = "byRecency";

export const VECTOR_BUCKET = "distributr-vectors";
export const VECTOR_INDEX = "stories";

export const EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0";
export const EMBED_DIM = 1024;
export const LLM_MODEL_ID = "amazon.nova-lite-v1:0";

export const CATEGORIES = [
  "world",
  "politics",
  "business",
  "technology",
  "science",
  "health",
  "environment",
  "sports",
  "culture",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

export const ANON_SOURCE_NAME = "Anonymous contributor";
export const IP_DAILY_LIMIT = 20;
export const DAILY_CONTRIB_LLM_CAP = 200;
export const DAILY_FEED_LLM_CAP = 240;
export const CANDIDATE_TOP_K = 3;
export const CANDIDATE_WINDOW_DAYS = 7;
export const MAX_SOURCES_PER_STORY = 25;
export const SUBMISSION_TTL_DAYS = 30;
export const FEED_ITEMS_PER_FEED_PER_RUN = 2;
export const FEED_MAX_AGE_HOURS = 48;

export const USER_AGENT = "distributr/0.1 (+https://github.com/TomBonness/distributr)";

export const FEEDS: readonly { name: string; url: string }[] = [
  { name: "BBC News – World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "BBC News – Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "The Guardian – World", url: "https://www.theguardian.com/world/rss" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { name: "SEC Press Releases", url: "https://www.sec.gov/news/pressreleases.rss" },
  { name: "NASA News Releases", url: "https://www.nasa.gov/news-release/feed/" },
  { name: "WHO News", url: "https://www.who.int/rss-feeds/news-english.xml" },
];
