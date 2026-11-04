import { randomUUID } from "node:crypto";

import { ANON_SOURCE_NAME, DAILY_CONTRIB_LLM_CAP, IP_DAILY_LIMIT, SUBMISSION_TTL_DAYS } from "./config.ts";
import type { Deps } from "./deps.ts";
import { BadRequest, QuotaExceeded } from "./errors.ts";
import { ingest } from "./ingest.ts";
import { safeHttpUrl } from "./story.ts";
import type { SubmissionResponse } from "./types.ts";
import { epochSec, sha256hex, utcDay } from "./util.ts";

function optionalString(body: Record<string, unknown>, key: string, message: string): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new BadRequest(message);
  return v.trim() || undefined;
}

/**
 * Anonymous contribution: validate, charge the per-IP and hub-wide daily
 * counters, then run the editor. The raw IP is never stored; only its hash
 * appears inside expiring counter keys.
 */
export async function submitContribution(
  deps: Deps,
  ctx: { ip: string; baseUrl: string },
  body: unknown,
): Promise<SubmissionResponse> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const text = typeof b["text"] === "string" ? b["text"].trim() : "";
  if (text.length < 20 || text.length > 20000) throw new BadRequest("text must be 20-20000 characters");
  const urlMsg = "url must be an http(s) URL up to 2048 characters";
  const url = optionalString(b, "url", urlMsg);
  if (url !== undefined && (url.length > 2048 || !safeHttpUrl(url))) throw new BadRequest(urlMsg);
  const titleMsg = "title must be at most 300 characters";
  const title = optionalString(b, "title", titleMsg);
  if (title !== undefined && title.length > 300) throw new BadRequest(titleMsg);

  const now = deps.now();
  const nowSec = epochSec(now);
  const day = utcDay(now);
  const counterExpiry = nowSec + 3 * 86400;
  const ipKey = "quota#ip#" + sha256hex(ctx.ip).slice(0, 32) + "#" + day;
  if (!(await deps.control.consume(ipKey, IP_DAILY_LIMIT, counterExpiry))) {
    throw new QuotaExceeded("daily contribution limit reached for your network address; retry after 00:00 UTC");
  }
  if (!(await deps.control.consume("quota#llm#contrib#" + day, DAILY_CONTRIB_LLM_CAP, counterExpiry))) {
    throw new QuotaExceeded("hub daily contribution capacity reached; retry after 00:00 UTC");
  }

  const id = randomUUID();
  await deps.submissions.claim({
    id,
    kind: "contributor",
    sourceName: ANON_SOURCE_NAME,
    url,
    title,
    text,
    status: "processing",
    createdAt: now.toISOString(),
    expiresAt: nowSec + SUBMISSION_TTL_DAYS * 86400,
  });

  try {
    const result = await ingest(deps, { submissionId: id, kind: "contributor", sourceName: ANON_SOURCE_NAME, url, title, text });
    if (result.status === "rejected") {
      await deps.submissions.finish(id, { status: "rejected", reason: result.reason });
      return { submissionId: id, status: "rejected", reason: result.reason };
    }
    await deps.submissions.finish(id, { status: result.status, storyId: result.storyId });
    return {
      submissionId: id,
      status: result.status,
      storyId: result.storyId,
      storyUrl: ctx.baseUrl + "/s/" + result.storyId,
    };
  } catch (e) {
    await deps.submissions.finish(id, { status: "failed", reason: (e as Error).message.slice(0, 300) });
    throw e;
  }
}
