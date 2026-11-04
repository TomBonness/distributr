import { randomUUID } from "node:crypto";

import { CANDIDATE_TOP_K, CANDIDATE_WINDOW_DAYS } from "./config.ts";
import type { Deps } from "./deps.ts";
import { EDITOR_SYSTEM_PROMPT, buildEditorMessage } from "./prompt.ts";
import { normalizeReport } from "./report.ts";
import { mergeSources, safeHttpUrl, storyText } from "./story.ts";
import type { IngestInput, IngestResult, Source, Story } from "./types.ts";
import { epochSec } from "./util.ts";

/**
 * One submission through the desk editor: find recent similar stories, let
 * the LLM reject / merge / create, then write the story and its vector (story
 * first, so a vector never points at a missing story).
 */
export async function ingest(deps: Deps, input: IngestInput): Promise<IngestResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const nowSec = epochSec(now);

  const probe = await deps.ai.embed(((input.title ?? "") + "\n" + input.text).slice(0, 4000));
  const hits = await deps.vectors.query(probe, CANDIDATE_TOP_K, {
    updatedAt: { $gte: nowSec - CANDIDATE_WINDOW_DAYS * 86400 },
  });
  const candidates = await deps.stories.getMany(hits.map((h) => h.id));

  const raw = await deps.ai.fileReport(EDITOR_SYSTEM_PROMPT, buildEditorMessage(candidates, input, nowIso));
  const report = normalizeReport(
    raw,
    candidates.map((c) => c.id),
  );
  if (report.decision === "reject") return { status: "rejected", reason: report.rejectReason };

  const source: Source = {
    name: input.sourceName,
    kind: input.kind,
    url: safeHttpUrl(input.url),
    title: input.title,
    addedAt: nowIso,
  };

  let story: Story;
  const prev = report.decision === "merge" ? candidates.find((c) => c.id === report.mergeStoryId) : undefined;
  if (prev) {
    story = {
      ...prev,
      ...report.draft,
      eventDate: report.draft.eventDate ?? prev.eventDate,
      sources: mergeSources(prev.sources, source),
      submissionCount: prev.submissionCount + 1,
      updatedAt: nowIso,
      version: prev.version + 1,
    };
    await deps.stories.replace(story, prev.version);
  } else {
    story = {
      id: randomUUID(),
      kind: "story",
      ...report.draft,
      sources: [source],
      submissionCount: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await deps.stories.create(story);
  }

  const vec = await deps.ai.embed(storyText(story));
  await deps.vectors.put(story.id, vec, { category: story.category, updatedAt: nowSec });
  return { status: prev ? "merged" : "created", storyId: story.id };
}
