/**
 * Ports for every side effect. shared/aws.ts implements them against AWS;
 * __tests__/fakes.ts implements them in memory.
 */
import type { Category } from "./config.ts";
import type { Story, Submission, SubmissionStatus } from "./types.ts";

export interface StoryStore {
  get(id: string): Promise<Story | undefined>;
  getMany(ids: string[]): Promise<Story[]>;
  /** Conditional on attribute_not_exists(id). */
  create(s: Story): Promise<void>;
  /** Conditional on version === expectedVersion; throws StoryConflict otherwise. */
  replace(s: Story, expectedVersion: number): Promise<void>;
  latest(p: { category?: Category; limit: number; cursor?: string }): Promise<{ stories: Story[]; cursor?: string }>;
}

export interface SubmissionStore {
  /** Puts the submission unless its id exists; false when it already did. */
  claim(sub: Submission): Promise<boolean>;
  finish(id: string, patch: { status: SubmissionStatus; storyId?: string; reason?: string }): Promise<void>;
}

export interface ControlStore {
  /** Atomically increments counterPk unless it already reached limit; false when it had. */
  consume(counterPk: string, limit: number, expiresAt: number): Promise<boolean>;
}

export type VectorFilter = Record<string, unknown>;

export interface VectorIndex {
  query(vector: number[], topK: number, filter: VectorFilter): Promise<{ id: string; distance: number }[]>;
  put(id: string, vector: number[], metadata: { category: Category; updatedAt: number }): Promise<void>;
}

export interface Ai {
  embed(text: string): Promise<number[]>;
  /** Raw `input` of the editor's file_report tool call. */
  fileReport(system: string, user: string): Promise<unknown>;
}

export interface Deps {
  stories: StoryStore;
  submissions: SubmissionStore;
  control: ControlStore;
  vectors: VectorIndex;
  ai: Ai;
  now: () => Date;
}
