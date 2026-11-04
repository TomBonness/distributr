import assert from "node:assert/strict";
import { test } from "node:test";

import { UpstreamError } from "../shared/errors.ts";
import { normalizeReport } from "../shared/report.ts";
import type { StoryDraft } from "../shared/types.ts";
import { newReport } from "./fakes.ts";

function draftOf(raw: unknown): StoryDraft {
  const r = normalizeReport(raw, []);
  return r.decision === "reject" ? assert.fail("unexpected reject") : r.draft;
}

test("unknown category becomes other", () => {
  assert.equal(draftOf(newReport({ category: "gossip" })).category, "other");
});

test("headline over 160 chars is clamped with an ellipsis", () => {
  const h = draftOf(newReport({ headline: "x".repeat(400) })).headline;
  assert.equal(h.length, 160);
  assert.ok(h.endsWith("…"));
});

test("more than 10 key facts are cut to 10, blanks dropped", () => {
  const facts = ["", "  ", ...Array.from({ length: 14 }, (_, i) => `fact ${i}`)];
  const kf = draftOf(newReport({ keyFacts: facts })).keyFacts;
  assert.equal(kf.length, 10);
  assert.equal(kf[0], "fact 0");
});

test("malformed eventDate is dropped, valid one kept", () => {
  assert.equal(draftOf(newReport({ eventDate: "3 November 2026" })).eventDate, undefined);
  assert.equal(draftOf(newReport({ eventDate: "2026-11-03" })).eventDate, "2026-11-03");
});

test("new without summary throws UpstreamError", () => {
  assert.throws(() => normalizeReport(newReport({ summary: "   " }), []), UpstreamError);
});

test("reject without reason becomes unspecified", () => {
  assert.deepEqual(normalizeReport({ decision: "reject" }, []), { decision: "reject", rejectReason: "unspecified" });
});

test("invalid decision or non-object throws", () => {
  assert.throws(() => normalizeReport({ decision: "maybe" }, []), UpstreamError);
  assert.throws(() => normalizeReport("new", []), UpstreamError);
});

test("entities are deduped case-insensitively", () => {
  assert.deepEqual(draftOf(newReport({ entities: ["NASA", "nasa", " Mars ", "Mars"] })).entities, ["NASA", "Mars"]);
});
