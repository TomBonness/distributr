import { isCategory } from "./config.ts";
import { UpstreamError } from "./errors.ts";
import type { Report } from "./types.ts";
import { clamp } from "./util.ts";

function trimmedStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : []));
}

/** Validates and clamps the editor's raw file_report input. The LLM is untrusted. */
export function normalizeReport(raw: unknown, candidateIds: string[]): Report {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UpstreamError("editor report invalid");
  const r = raw as Record<string, unknown>;
  const decision = r["decision"];
  if (decision !== "new" && decision !== "merge" && decision !== "reject") {
    throw new UpstreamError("editor report invalid");
  }

  if (decision === "reject") {
    const reason = typeof r["rejectReason"] === "string" ? clamp(r["rejectReason"].trim(), 300) : "";
    return { decision: "reject", rejectReason: reason || "unspecified" };
  }

  const mergeStoryId = r["mergeStoryId"];
  const isMerge = decision === "merge" && typeof mergeStoryId === "string" && candidateIds.includes(mergeStoryId);

  const headline = typeof r["headline"] === "string" ? clamp(r["headline"].trim(), 160) : "";
  const summary = typeof r["summary"] === "string" ? clamp(r["summary"].trim(), 1200) : "";
  if (!headline || !summary) throw new UpstreamError("editor report missing headline/summary");

  const seen = new Set<string>();
  const entities: string[] = [];
  for (const e of trimmedStrings(r["entities"])) {
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push(clamp(e, 100));
    if (entities.length === 10) break;
  }

  const eventDate = r["eventDate"];
  const draft = {
    headline,
    summary,
    keyFacts: trimmedStrings(r["keyFacts"])
      .slice(0, 10)
      .map((f) => clamp(f, 300)),
    category: isCategory(r["category"]) ? r["category"] : "other",
    entities,
    ...(typeof eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? { eventDate } : {}),
  };
  return isMerge ? { decision: "merge", mergeStoryId, draft } : { decision: "new", draft };
}
