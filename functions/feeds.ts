/**
 * distributr-feeds: every 2h, pull each feed's newest items through the desk
 * editor. Feeds run sequentially so concurrent ingests can't each create the
 * same story.
 */
import { realDeps } from "./shared/aws.ts";
import {
  DAILY_FEED_LLM_CAP,
  FEED_ITEMS_PER_FEED_PER_RUN,
  FEED_MAX_AGE_HOURS,
  FEEDS,
  SUBMISSION_TTL_DAYS,
  USER_AGENT,
} from "./shared/config.ts";
import type { Deps } from "./shared/deps.ts";
import { ingest } from "./shared/ingest.ts";
import { type FeedItem, parseFeed } from "./shared/rss.ts";
import { epochSec, sha256hex, utcDay } from "./shared/util.ts";

export interface FeedRunStats {
  feeds: number;
  claimed: number;
  created: number;
  merged: number;
  rejected: number;
  failed: number;
  capped: boolean;
}

async function fetchItems(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

export async function runFeeds(deps: Deps): Promise<FeedRunStats> {
  const stats: FeedRunStats = { feeds: FEEDS.length, claimed: 0, created: 0, merged: 0, rejected: 0, failed: 0, capped: false };
  const runStart = deps.now();
  const cutoff = runStart.getTime() - FEED_MAX_AGE_HOURS * 3600_000;
  const capKey = "quota#llm#feeds#" + utcDay(runStart);

  feeds: for (const feed of FEEDS) {
    let items: FeedItem[];
    try {
      items = await fetchItems(feed.url);
    } catch (e) {
      console.error(JSON.stringify({ feed: feed.name, error: String(e) }));
      continue;
    }
    // Newest first; undated items last.
    const fresh = items
      .filter((i) => !i.publishedAt || i.publishedAt.getTime() >= cutoff)
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

    let ingested = 0;
    for (const item of fresh) {
      if (ingested >= FEED_ITEMS_PER_FEED_PER_RUN) break;
      const id = "feed_" + sha256hex(item.guid ?? item.link ?? "").slice(0, 40);
      const text = item.summary || item.title;
      const now = deps.now();
      const nowSec = epochSec(now);
      const claimed = await deps.submissions.claim({
        id,
        kind: "feed",
        sourceName: feed.name,
        url: item.link,
        title: item.title || undefined,
        text,
        status: "processing",
        createdAt: now.toISOString(),
        expiresAt: nowSec + SUBMISSION_TTL_DAYS * 86400,
      });
      if (!claimed) continue;
      stats.claimed++;

      if (!(await deps.control.consume(capKey, DAILY_FEED_LLM_CAP, nowSec + 3 * 86400))) {
        await deps.submissions.finish(id, { status: "failed", reason: "daily_cap" });
        stats.capped = true;
        break feeds;
      }
      ingested++;

      try {
        const r = await ingest(deps, {
          submissionId: id,
          kind: "feed",
          sourceName: feed.name,
          url: item.link,
          title: item.title || undefined,
          text,
        });
        if (r.status === "rejected") {
          await deps.submissions.finish(id, { status: "rejected", reason: r.reason });
          stats.rejected++;
        } else {
          await deps.submissions.finish(id, { status: r.status, storyId: r.storyId });
          stats[r.status]++;
        }
      } catch (e) {
        console.error(JSON.stringify({ feed: feed.name, submissionId: id, error: String(e) }));
        await deps.submissions.finish(id, { status: "failed", reason: String(e).slice(0, 300) });
        stats.failed++;
      }
    }
  }

  console.log(JSON.stringify(stats));
  return stats;
}

export async function handler(): Promise<FeedRunStats> {
  return runFeeds(realDeps());
}
