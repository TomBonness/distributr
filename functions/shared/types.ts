import type { Category } from "./config.ts";

export interface Source {
  name: string;
  kind: "feed" | "contributor";
  url?: string;
  title?: string;
  addedAt: string;
}

export interface StoryDraft {
  headline: string;
  summary: string;
  keyFacts: string[];
  category: Category;
  entities: string[];
  eventDate?: string;
}

export interface Story extends StoryDraft {
  id: string;
  /** Constant "story": partition key of the byRecency GSI. */
  kind: "story";
  sources: Source[];
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PublicStory {
  id: string;
  headline: string;
  summary: string;
  keyFacts: string[];
  category: Category;
  entities: string[];
  eventDate: string | null;
  sources: Source[];
  sourceCount: number;
  corroboration: "single-source" | "multi-source";
  createdAt: string;
  updatedAt: string;
  url: string;
}

export type SubmissionStatus = "processing" | "created" | "merged" | "rejected" | "failed";

/** No IP or IP hash is ever stored here. */
export interface Submission {
  id: string;
  kind: "feed" | "contributor";
  sourceName: string;
  url?: string;
  title?: string;
  text: string;
  status: SubmissionStatus;
  storyId?: string;
  reason?: string;
  createdAt: string;
  expiresAt: number;
}

export type Report =
  | { decision: "reject"; rejectReason: string }
  | { decision: "new" | "merge"; mergeStoryId?: string; draft: StoryDraft };

export interface IngestInput {
  submissionId: string;
  kind: "feed" | "contributor";
  sourceName: string;
  url?: string;
  title?: string;
  text: string;
}

export type IngestResult =
  | { status: "created" | "merged"; storyId: string }
  | { status: "rejected"; reason: string };

export type SubmissionResponse =
  | { submissionId: string; status: "created" | "merged"; storyId: string; storyUrl: string }
  | { submissionId: string; status: "rejected"; reason: string };
