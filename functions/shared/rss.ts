/**
 * RSS 2.0 / Atom → FeedItem. Uses only the feed's own headline and blurb;
 * article pages are never fetched.
 */
import { XMLParser } from "fast-xml-parser";

import { clamp } from "./util.ts";

export interface FeedItem {
  guid?: string;
  title: string;
  link?: string;
  summary: string;
  publishedAt?: Date;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Keep "2026" titles and numeric guids as strings.
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry",
});

type Node = Record<string, unknown>;

function textOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (v && typeof v === "object" && "#text" in v) return textOf((v as Node)["#text"]);
  return undefined;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|nbsp|#39|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (lower in NAMED) return NAMED[lower] ?? m;
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** Strip tags, decode entities, collapse whitespace. */
function cleanText(v: unknown): string {
  const s = textOf(v);
  if (!s) return "";
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function atomLink(link: unknown): string | undefined {
  const links = (Array.isArray(link) ? link : [link]).filter((l): l is Node => !!l && typeof l === "object");
  const chosen = links.find((l) => l["@_rel"] === undefined || l["@_rel"] === "alternate") ?? links[0];
  return textOf(chosen?.["@_href"]) ?? textOf(link);
}

function parseDate(v: unknown): Date | undefined {
  const s = textOf(v);
  if (!s) return undefined;
  const d = new Date(s.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Node;
  const rss = (doc["rss"] as Node | undefined)?.["channel"] as Node | undefined;
  const atom = doc["feed"] as Node | undefined;
  const isAtom = !rss && !!atom;
  const raw = ((rss?.["item"] ?? atom?.["entry"] ?? []) as unknown[]).filter((n): n is Node => !!n && typeof n === "object");

  const out: FeedItem[] = [];
  for (const n of raw) {
    const guid = decodeEntities(textOf(isAtom ? n["id"] : n["guid"]) ?? "").trim() || undefined;
    const link = decodeEntities((isAtom ? atomLink(n["link"]) : textOf(n["link"])) ?? "").trim() || undefined;
    const title = cleanText(n["title"]);
    const summary = clamp(cleanText(n["description"] ?? n["summary"] ?? n["content"]), 2000);
    if (!guid && !link) continue;
    if (!title && !summary) continue;
    out.push({
      ...(guid ? { guid } : {}),
      title,
      ...(link ? { link } : {}),
      summary,
      publishedAt: parseDate(n["pubDate"] ?? n["published"] ?? n["updated"] ?? n["dc:date"]),
    });
  }
  return out;
}
