import { MAX_SOURCES_PER_STORY } from "./config.ts";
import type { PublicStory, Source, Story } from "./types.ts";

/** Appends incoming unless its URL is already linked; keeps the newest MAX_SOURCES_PER_STORY. */
export function mergeSources(existing: Source[], incoming: Source): Source[] {
  if (incoming.url && existing.some((s) => s.url === incoming.url)) return existing;
  return [...existing, incoming].slice(-MAX_SOURCES_PER_STORY);
}

/** Text that represents a story in the vector index. */
export function storyText(s: Story): string {
  return s.headline + "\n" + s.summary + "\n" + s.keyFacts.join("\n");
}

export function toPublicStory(s: Story, baseUrl: string): PublicStory {
  // All anonymous contributions share one source name, so they count once.
  const names = new Set(s.sources.map((src) => src.name.toLowerCase()));
  return {
    id: s.id,
    headline: s.headline,
    summary: s.summary,
    keyFacts: s.keyFacts,
    category: s.category,
    entities: s.entities,
    eventDate: s.eventDate ?? null,
    sources: s.sources,
    sourceCount: s.sources.length,
    corroboration: names.size >= 2 ? "multi-source" : "single-source",
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    url: baseUrl + "/s/" + s.id,
  };
}

/** Returns u only when it parses as an http(s) URL. Gate for ingest and every rendered href. */
export function safeHttpUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}
