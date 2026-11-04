import assert from "node:assert/strict";
import { test } from "node:test";

import { ANON_SOURCE_NAME, MAX_SOURCES_PER_STORY } from "../shared/config.ts";
import { mergeSources, safeHttpUrl, toPublicStory } from "../shared/story.ts";
import type { Source, Story } from "../shared/types.ts";

function story(sources: Source[]): Story {
  return {
    id: "s1",
    kind: "story",
    headline: "h",
    summary: "s",
    keyFacts: [],
    category: "world",
    entities: [],
    sources,
    submissionCount: sources.length,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
    version: 1,
  };
}

const src = (name: string, url?: string): Source => ({
  name,
  kind: name === ANON_SOURCE_NAME ? "contributor" : "feed",
  ...(url ? { url } : {}),
  addedAt: "2026-11-04T00:00:00Z",
});

test("two distinct source names are multi-source", () => {
  const p = toPublicStory(story([src("BBC News – World"), src("NPR News")]), "https://hub.example");
  assert.equal(p.corroboration, "multi-source");
  assert.equal(p.sourceCount, 2);
  assert.equal(p.url, "https://hub.example/s/s1");
  assert.equal(p.eventDate, null);
});

test("any number of anonymous contributions is single-source", () => {
  const p = toPublicStory(story([src(ANON_SOURCE_NAME, "https://a"), src(ANON_SOURCE_NAME, "https://b")]), "");
  assert.equal(p.corroboration, "single-source");
  assert.equal(p.sourceCount, 2);
});

test("mergeSources caps at MAX_SOURCES_PER_STORY keeping the newest", () => {
  let sources: Source[] = [];
  for (let i = 0; i < 30; i++) sources = mergeSources(sources, src(`feed ${i}`, `https://example.org/${i}`));
  assert.equal(sources.length, MAX_SOURCES_PER_STORY);
  assert.equal(sources[0]?.name, "feed 5");
  assert.equal(sources.at(-1)?.name, "feed 29");
});

test("safeHttpUrl accepts only http(s)", () => {
  assert.equal(safeHttpUrl("https://example.org/x"), "https://example.org/x");
  assert.equal(safeHttpUrl("http://example.org"), "http://example.org");
  assert.equal(safeHttpUrl("javascript:alert(1)"), undefined);
  assert.equal(safeHttpUrl("data:text/html,hi"), undefined);
  assert.equal(safeHttpUrl("not a url"), undefined);
});
