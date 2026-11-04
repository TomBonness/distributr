import assert from "node:assert/strict";
import { test } from "node:test";

import { ANON_SOURCE_NAME, DAILY_CONTRIB_LLM_CAP, IP_DAILY_LIMIT } from "../shared/config.ts";
import { submitContribution } from "../shared/contribute.ts";
import { BadRequest, QuotaExceeded } from "../shared/errors.ts";
import { sha256hex } from "../shared/util.ts";
import { fakeDeps, newReport } from "./fakes.ts";

const IP = "203.0.113.7";
const CTX = { ip: IP, baseUrl: "https://hub.example" };
const BODY = {
  text: "The city council of Springfield voted 5-2 on 3 November 2026 to fund a library expansion.",
  url: "https://example.org/springfield-library",
};
const DAY = "2026-11-04";

test("valid contribution creates a story; submission stores no IP", async () => {
  const f = fakeDeps({ fileReport: () => newReport() });
  const r = await submitContribution(f.deps, CTX, BODY);
  assert.equal(r.status, "created");
  assert.ok(r.status === "created");
  assert.equal(r.storyUrl, `https://hub.example/s/${r.storyId}`);

  const sub = f.submissions.get(r.submissionId);
  assert.ok(sub);
  assert.equal(sub.sourceName, ANON_SOURCE_NAME);
  assert.equal(sub.status, "created");
  assert.equal(sub.storyId, r.storyId);
  assert.ok(!("ip" in sub));
  assert.ok(!JSON.stringify(sub).includes(IP));
  assert.ok(!JSON.stringify(sub).includes(sha256hex(IP).slice(0, 32)));
});

test("per-IP daily limit blocks before any LLM call", async () => {
  const f = fakeDeps({ fileReport: () => newReport() });
  f.counters.set(`quota#ip#${sha256hex(IP).slice(0, 32)}#${DAY}`, IP_DAILY_LIMIT);
  await assert.rejects(submitContribution(f.deps, CTX, BODY), QuotaExceeded);
  assert.equal(f.calls.fileReport, 0);
  assert.equal(f.submissions.size, 0);
});

test("hub-wide contribution cap blocks", async () => {
  const f = fakeDeps({ fileReport: () => newReport() });
  f.counters.set(`quota#llm#contrib#${DAY}`, DAILY_CONTRIB_LLM_CAP);
  await assert.rejects(submitContribution(f.deps, CTX, BODY), QuotaExceeded);
  assert.equal(f.calls.fileReport, 0);
});

test("non-http(s) url is rejected", async () => {
  const f = fakeDeps({ fileReport: () => newReport() });
  await assert.rejects(submitContribution(f.deps, CTX, { ...BODY, url: "javascript:alert(1)" }), BadRequest);
  assert.equal(f.counters.size, 0);
});

test("too-short text is rejected", async () => {
  const f = fakeDeps({ fileReport: () => newReport() });
  await assert.rejects(submitContribution(f.deps, CTX, { text: "too short" }), BadRequest);
});

test("editor failure marks the submission failed and rethrows", async () => {
  const f = fakeDeps({ fileReport: () => ({ decision: "nonsense" }) });
  await assert.rejects(submitContribution(f.deps, CTX, BODY), /editor report invalid/);
  const [sub] = f.submissions.values();
  assert.equal(sub?.status, "failed");
  assert.equal(sub?.reason, "editor report invalid");
});
