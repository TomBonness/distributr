import { type Category, isCategory } from "./config.ts";
import type { Deps, VectorFilter } from "./deps.ts";
import { BadRequest } from "./errors.ts";
import { toPublicStory } from "./story.ts";
import type { PublicStory, Story } from "./types.ts";
import { epochSec } from "./util.ts";

export type QueryParams = Record<string, string | undefined>;

export interface SearchParams {
  q: string;
  category?: Category;
  days: number;
  limit: number;
}

export interface LatestParams {
  category?: Category;
  limit: number;
  cursor?: string;
}

function intParam(raw: string | undefined, name: string, min: number, max: number, dflt: number): number {
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`${name} must be an integer ${min}-${max}`);
  return n;
}

function categoryParam(raw: string | undefined): Category | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!isCategory(raw)) throw new BadRequest("unknown category");
  return raw;
}

export function parseSearchParams(qs: QueryParams): SearchParams {
  const q = (qs["q"] ?? "").trim();
  if (q.length < 1 || q.length > 500) throw new BadRequest("q must be 1-500 characters");
  const category = categoryParam(qs["category"]);
  return {
    q,
    ...(category ? { category } : {}),
    days: intParam(qs["days"], "days", 1, 365, 30),
    limit: intParam(qs["limit"], "limit", 1, 20, 8),
  };
}

export function buildSearchFilter(p: SearchParams, nowSec: number): VectorFilter {
  const recency = { updatedAt: { $gte: nowSec - p.days * 86400 } };
  return p.category ? { $and: [recency, { category: { $eq: p.category } }] } : recency;
}

export async function searchStories(deps: Deps, p: SearchParams): Promise<(Story & { score: number })[]> {
  const vec = await deps.ai.embed(p.q);
  const hits = await deps.vectors.query(vec, p.limit, buildSearchFilter(p, epochSec(deps.now())));
  const byId = new Map((await deps.stories.getMany(hits.map((h) => h.id))).map((s) => [s.id, s]));
  return hits.flatMap((h) => {
    const s = byId.get(h.id);
    return s ? [{ ...s, score: Math.round((1 - h.distance) * 1000) / 1000 }] : [];
  });
}

/** The search response shared by REST and MCP. */
export async function searchResponse(deps: Deps, p: SearchParams, base: string) {
  const results = await searchStories(deps, p);
  return {
    query: p.q,
    category: p.category ?? null,
    days: p.days,
    results: results.map(({ score, ...s }): PublicStory & { score: number } => ({ ...toPublicStory(s, base), score })),
  };
}

/** The latest-stories response shared by REST and MCP. */
export async function latestResponse(deps: Deps, p: LatestParams, base: string) {
  const r = await deps.stories.latest(p);
  return { stories: r.stories.map((s) => toPublicStory(s, base)), cursor: r.cursor ?? null };
}

export function parseLatestParams(qs: QueryParams): LatestParams {
  const category = categoryParam(qs["category"]);
  const cursor = qs["cursor"] || undefined;
  return {
    ...(category ? { category } : {}),
    limit: intParam(qs["limit"], "limit", 1, 50, 20),
    ...(cursor ? { cursor } : {}),
  };
}
