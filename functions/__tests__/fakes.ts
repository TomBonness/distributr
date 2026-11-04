/**
 * In-memory Deps. Stores hand out structured clones, like DynamoDB would, so
 * tests observe only what was actually written.
 */
import { createHash } from "node:crypto";

import type { Category } from "../shared/config.ts";
import type { Deps } from "../shared/deps.ts";
import { StoryConflict } from "../shared/errors.ts";
import type { Story, Submission } from "../shared/types.ts";

export const FIXED_NOW = new Date("2026-11-04T12:00:00.000Z");

export interface FakeOpts {
  fileReport?: (system: string, user: string) => unknown;
  now?: Date;
}

function unitVector(text: string): number[] {
  const bytes = createHash("sha256").update(text).digest();
  const v = Array.from(bytes.subarray(0, 8), (b) => b - 127.5);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

export function fakeDeps(opts: FakeOpts = {}) {
  const stories = new Map<string, Story>();
  const submissions = new Map<string, Submission>();
  const counters = new Map<string, number>();
  const vectors = new Map<string, { vector: number[]; metadata: { category: Category; updatedAt: number } }>();
  const vectorPuts: { id: string; metadata: { category: Category; updatedAt: number } }[] = [];
  const calls = { fileReport: 0 };

  const deps: Deps = {
    stories: {
      async get(id) {
        const s = stories.get(id);
        return s && structuredClone(s);
      },
      async getMany(ids) {
        return ids.flatMap((id) => {
          const s = stories.get(id);
          return s ? [structuredClone(s)] : [];
        });
      },
      async create(s) {
        if (stories.has(s.id)) throw new Error("ConditionalCheckFailedException");
        stories.set(s.id, structuredClone(s));
      },
      async replace(s, expectedVersion) {
        if (stories.get(s.id)?.version !== expectedVersion) throw new StoryConflict();
        stories.set(s.id, structuredClone(s));
      },
      async latest({ category, limit }) {
        const all = [...stories.values()]
          .filter((s) => !category || s.category === category)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return { stories: all.slice(0, limit).map((s) => structuredClone(s)) };
      },
    },
    submissions: {
      async claim(sub) {
        if (submissions.has(sub.id)) return false;
        submissions.set(sub.id, structuredClone(sub));
        return true;
      },
      async finish(id, patch) {
        const s = submissions.get(id);
        if (!s) throw new Error(`no submission ${id}`);
        submissions.set(id, { ...s, ...patch });
      },
    },
    control: {
      async consume(pk, limit) {
        const n = counters.get(pk) ?? 0;
        if (n >= limit) return false;
        counters.set(pk, n + 1);
        return true;
      },
    },
    vectors: {
      async query(vector, topK) {
        return [...vectors.entries()]
          .map(([id, v]) => ({ id, dot: v.vector.reduce((acc, x, i) => acc + x * (vector[i] ?? 0), 0) }))
          .sort((a, b) => b.dot - a.dot)
          .slice(0, topK)
          .map(({ id, dot }) => ({ id, distance: 1 - dot }));
      },
      async put(id, vector, metadata) {
        vectors.set(id, { vector, metadata });
        vectorPuts.push({ id, metadata });
      },
    },
    ai: {
      async embed(text) {
        return unitVector(text);
      },
      async fileReport(system, user) {
        calls.fileReport++;
        if (!opts.fileReport) throw new Error("fileReport not configured");
        return opts.fileReport(system, user);
      },
    },
    now: () => opts.now ?? FIXED_NOW,
  };

  return { deps, stories, submissions, counters, vectorPuts, calls };
}

/** A minimal valid "new" file_report input. */
export function newReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: "new",
    headline: "Council approves library expansion",
    summary: "The council approved funding for a library expansion. Construction starts in March.",
    keyFacts: ["The vote was 5-2."],
    category: "politics",
    entities: ["Springfield"],
    eventDate: "2026-11-03",
    ...overrides,
  };
}
