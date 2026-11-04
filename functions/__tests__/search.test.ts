import assert from "node:assert/strict";
import { test } from "node:test";

import { BadRequest } from "../shared/errors.ts";
import { buildSearchFilter, parseLatestParams, parseSearchParams } from "../shared/search.ts";

test("parseSearchParams rejects invalid input", () => {
  for (const qs of [
    {},
    { q: "   " },
    { q: "x".repeat(501) },
    { q: "rates", category: "gossip" },
    { q: "rates", limit: "0" },
    { q: "rates", limit: "21" },
    { q: "rates", limit: "2.5" },
    { q: "rates", days: "366" },
  ]) {
    assert.throws(() => parseSearchParams(qs), BadRequest, JSON.stringify(qs));
  }
});

test("parseSearchParams defaults to 30 days and limit 8", () => {
  assert.deepEqual(parseSearchParams({ q: " rates " }), { q: "rates", days: 30, limit: 8 });
});

test("filter adds a category clause only when a category is given", () => {
  const now = 1_000_000;
  const plain = buildSearchFilter(parseSearchParams({ q: "x", days: "2" }), now);
  assert.deepEqual(plain, { updatedAt: { $gte: now - 2 * 86400 } });
  const scoped = buildSearchFilter(parseSearchParams({ q: "x", category: "science" }), now);
  assert.deepEqual(scoped, {
    $and: [{ updatedAt: { $gte: now - 30 * 86400 } }, { category: { $eq: "science" } }],
  });
});

test("parseLatestParams bounds limit to 1-50", () => {
  assert.equal(parseLatestParams({}).limit, 20);
  assert.equal(parseLatestParams({ limit: "50" }).limit, 50);
  assert.throws(() => parseLatestParams({ limit: "51" }), BadRequest);
});
