/**
 * distributr-api: every HTTP route (HTML, REST JSON, llms.txt, MCP) behind
 * one HTTP API $default stage.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { realDeps } from "./shared/aws.ts";
import { CATEGORIES, isCategory } from "./shared/config.ts";
import { submitContribution } from "./shared/contribute.ts";
import { BadRequest, NotFound, QuotaExceeded, StoryConflict, UpstreamError } from "./shared/errors.ts";
import * as pages from "./shared/html.ts";
import { type HttpResult, bodyText, html, json, text } from "./shared/http.ts";
import { renderLlmsTxt } from "./shared/llms.ts";
import { type QueryParams, latestResponse, parseLatestParams, parseSearchParams, searchResponse } from "./shared/search.ts";
import { toPublicStory } from "./shared/story.ts";

const deps = realDeps();
const STORY_ID = /^[A-Za-z0-9-]{1,64}$/;
const PAGE_LIST_LIMIT = 30;

function errorInfo(e: unknown): { status: number; code: string; message: string } {
  if (e instanceof BadRequest) return { status: 400, code: "bad_request", message: e.message };
  if (e instanceof NotFound) return { status: 404, code: "not_found", message: e.message };
  if (e instanceof StoryConflict) return { status: 409, code: "conflict", message: "story was updated concurrently; retry" };
  if (e instanceof QuotaExceeded) return { status: 429, code: "quota_exceeded", message: e.message };
  if (e instanceof UpstreamError) return { status: 502, code: "upstream_error", message: e.message };
  return { status: 500, code: "internal", message: "internal error" };
}

async function getStory(id: string) {
  const story = STORY_ID.test(id) ? await deps.stories.get(id) : undefined;
  if (!story) throw new NotFound("story not found");
  return story;
}

async function searchHtml(qs: QueryParams, base: string): Promise<HttpResult> {
  const q = qs["q"] ?? "";
  if (!q.trim()) return html(200, pages.searchPage({ q: "" }));
  let p;
  try {
    p = parseSearchParams(qs);
  } catch (e) {
    if (e instanceof BadRequest) return html(400, pages.searchPage({ q, category: qs["category"], error: e.message }));
    throw e;
  }
  const r = await searchResponse(deps, p, base);
  return html(200, pages.searchPage({ q: p.q, category: p.category, results: r.results }));
}

async function contributeHtml(event: APIGatewayProxyEventV2, base: string): Promise<HttpResult> {
  const form = new URLSearchParams(bodyText(event));
  const values = { text: form.get("text") ?? "", url: form.get("url") ?? "", title: form.get("title") ?? "" };
  try {
    const r = await submitContribution(deps, { ip: event.requestContext.http.sourceIp, baseUrl: base }, values);
    return html(200, pages.contributeResultPage(r));
  } catch (e) {
    if (e instanceof BadRequest) return html(400, pages.contributePage({ error: e.message, values }));
    if (e instanceof QuotaExceeded) return html(429, pages.contributePage({ error: e.message, values }));
    throw e;
  }
}

async function route(event: APIGatewayProxyEventV2, method: string, path: string, base: string): Promise<HttpResult> {
  const qs: QueryParams = event.queryStringParameters ?? {};
  // Lazy on purpose: the MCP SDK + zod init would otherwise add to every route's cold start (esbuild keeps it lazy).
  if (path === "/mcp") return (await import("./shared/mcp.ts")).handleMcp(event, deps, base);

  if (method === "GET") {
    if (path === "/") {
      const r = await latestResponse(deps, { limit: PAGE_LIST_LIMIT }, base);
      return html(200, pages.homePage(r.stories));
    }
    if (path.startsWith("/c/")) {
      const category = path.slice(3);
      if (!isCategory(category)) throw new NotFound("unknown category");
      const r = await latestResponse(deps, { category, limit: PAGE_LIST_LIMIT }, base);
      return html(200, pages.categoryPage(category, r.stories));
    }
    if (path === "/search") return searchHtml(qs, base);
    if (path.startsWith("/s/")) return html(200, pages.storyPage(toPublicStory(await getStory(path.slice(3)), base)));
    if (path === "/contribute") return html(200, pages.contributePage({}));
    if (path === "/llms.txt") return text(200, renderLlmsTxt(base), "text/plain; charset=utf-8");
    if (path === "/robots.txt") return text(200, "User-agent: *\nAllow: /\n", "text/plain; charset=utf-8");
    if (path === "/healthz") return json(200, { ok: true });
    if (path === "/api/v1/categories") return json(200, { categories: CATEGORIES });
    if (path === "/api/v1/search") return json(200, await searchResponse(deps, parseSearchParams(qs), base));
    if (path === "/api/v1/stories") return json(200, await latestResponse(deps, parseLatestParams(qs), base));
    if (path.startsWith("/api/v1/stories/")) {
      return json(200, toPublicStory(await getStory(path.slice("/api/v1/stories/".length)), base));
    }
  } else if (method === "POST") {
    if (path === "/contribute") return contributeHtml(event, base);
    if (path === "/api/v1/submissions") {
      let body: unknown;
      try {
        body = JSON.parse(bodyText(event));
      } catch {
        throw new BadRequest("invalid JSON body");
      }
      return json(200, await submitContribution(deps, { ip: event.requestContext.http.sourceIp, baseUrl: base }, body));
    }
  }
  throw new NotFound("not found");
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const base = "https://" + event.requestContext.domainName;
  let res: HttpResult;
  try {
    res = await route(event, method, path, base);
  } catch (e) {
    const err = errorInfo(e);
    if (err.status >= 500) {
      console.error(JSON.stringify({ method, path, error: String(e), stack: (e as Error | undefined)?.stack }));
    }
    res =
      path.startsWith("/api/") || path === "/mcp"
        ? json(err.status, { error: { code: err.code, message: err.message } })
        : html(err.status, pages.errorPage(err.status, err.message));
  }
  res.headers["cache-control"] ??= method === "GET" && res.statusCode < 500 ? "public, max-age=60" : "no-store";
  return res;
}
