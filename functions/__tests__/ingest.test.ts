import assert from "node:assert/strict";
import { test } from "node:test";

import { StoryConflict } from "../shared/errors.ts";
import { ingest } from "../shared/ingest.ts";
import type { IngestInput, IngestResult } from "../shared/types.ts";
import { fakeDeps, newReport } from "./fakes.ts";

function input(overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    submissionId: "sub-1",
    kind: "feed",
    sourceName: "Springfield Gazette",
    url: "https://example.org/a",
    title: "Library expansion approved",
    text: "The council approved a $4.2 million library expansion on 3 November 2026.",
    ...overrides,
  };
}

function createdId(r: IngestResult): string {
  if (r.status !== "created") return assert.fail(`expected created, got ${r.status}`);
  return r.storyId;
}

test("new: creates version 1 story with one source and a categorized vector", async () => {
  const f = fakeDeps({ fileReport: () => newReport({ category: "politics" }) });
  const s = f.stories.get(createdId(await ingest(f.deps, input())));
  assert.ok(s);
  assert.equal(s.version, 1);
  assert.equal(s.kind, "story");
  assert.equal(s.sources.length, 1);
  assert.equal(s.sources[0]?.url, "https://example.org/a");
  assert.equal(s.submissionCount, 1);
  assert.deepEqual(f.vectorPuts, [{ id: s.id, metadata: { category: "politics", updatedAt: 1793793600 } }]);
});

test("merge: keeps id, bumps version, appends source, counts submissions", async () => {
  let report: unknown = newReport();
  const f = fakeDeps({ fileReport: () => report });
  const id = createdId(await ingest(f.deps, input()));
  report = newReport({ decision: "merge", mergeStoryId: id, headline: "Library expansion: 9,000 sq ft" });

  const r = await ingest(f.deps, input({ sourceName: "Other Paper", url: "https://example.org/b" }));
  assert.deepEqual(r, { status: "merged", storyId: id });
  const s = f.stories.get(id);
  assert.ok(s);
  assert.equal(f.stories.size, 1);
  assert.equal(s.version, 2);
  assert.equal(s.submissionCount, 2);
  assert.equal(s.headline, "Library expansion: 9,000 sq ft");
  assert.deepEqual(
    s.sources.map((x) => x.url),
    ["https://example.org/a", "https://example.org/b"],
  );
  assert.equal(f.vectorPuts.length, 2);
});

test("merge: a source URL already linked is not duplicated", async () => {
  let report: unknown = newReport();
  const f = fakeDeps({ fileReport: () => report });
  const id = createdId(await ingest(f.deps, input()));
  report = newReport({ decision: "merge", mergeStoryId: id });

  await ingest(f.deps, input({ url: "https://example.org/a" }));
  const s = f.stories.get(id);
  assert.equal(s?.sources.length, 1);
  assert.equal(s?.version, 2);
});

test("merge into an id that was not a candidate creates a new story", async () => {
  let report: unknown = newReport();
  const f = fakeDeps({ fileReport: () => report });
  const id = createdId(await ingest(f.deps, input()));
  report = newReport({ decision: "merge", mergeStoryId: "not-a-candidate" });

  const other = createdId(await ingest(f.deps, input({ url: "https://example.org/c" })));
  assert.notEqual(other, id);
  assert.equal(f.stories.size, 2);
  assert.equal(f.stories.get(id)?.version, 1);
});

test("reject: writes no story and no vector", async () => {
  const f = fakeDeps({ fileReport: () => ({ decision: "reject", rejectReason: "advertising" }) });
  const r = await ingest(f.deps, input());
  assert.deepEqual(r, { status: "rejected", reason: "advertising" });
  assert.equal(f.stories.size, 0);
  assert.equal(f.vectorPuts.length, 0);
});

test("merge loses to a concurrent update with StoryConflict", async () => {
  let id = "";
  const f = fakeDeps({
    fileReport: () => {
      if (!id) return newReport();
      // Another writer bumps the version after the candidates were read.
      const stored = f.stories.get(id);
      assert.ok(stored);
      stored.version = 2;
      return newReport({ decision: "merge", mergeStoryId: id });
    },
  });
  id = createdId(await ingest(f.deps, input()));

  await assert.rejects(ingest(f.deps, input({ url: "https://example.org/d" })), StoryConflict);
  assert.equal(f.stories.get(id)?.sources.length, 1);
  assert.equal(f.vectorPuts.length, 1);
});
