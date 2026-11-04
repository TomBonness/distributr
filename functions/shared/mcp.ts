/**
 * MCP (SDK v2) over API Gateway v2: rebuild a web Request from the event,
 * serve it per invocation, and buffer the Response.
 *
 * - Modern (2026-07-28) requests go to createMcpHandler with legacy:"reject".
 * - 2025-era requests (classified by the SDK's own isLegacyRequest) go to a
 *   stateless streamable HTTP transport with enableJsonResponse, so plain
 *   clients and curl get one JSON body instead of a one-message SSE stream.
 * - API Gateway cannot stream, so a body still open after BODY_TIMEOUT_MS (an
 *   SSE stream such as subscriptions/listen) is cancelled and answered 405.
 *
 * Public endpoint with no ambient credentials: no Host/Origin validation.
 */
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as z from "zod/v4";

import { CATEGORIES } from "./config.ts";
import { submitContribution } from "./contribute.ts";
import type { Deps } from "./deps.ts";
import { BadRequest, NotFound, QuotaExceeded } from "./errors.ts";
import { type HttpResult, bodyText, json } from "./http.ts";
import { latestResponse, searchResponse } from "./search.ts";
import { toPublicStory } from "./story.ts";

const BODY_TIMEOUT_MS = 10_000;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Tool results carry the REST JSON shape; failures become isError results (client errors unlogged). */
async function run(tool: string, fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (e) {
    if (!(e instanceof BadRequest || e instanceof NotFound || e instanceof QuotaExceeded)) {
      console.error(JSON.stringify({ mcpTool: tool, error: String(e), stack: (e as Error).stack }));
    }
    return { content: [{ type: "text", text: (e as Error).message }], isError: true };
  }
}

function buildServer(deps: Deps, base: string, ip: string): McpServer {
  const server = new McpServer({ name: "distributr", version: "0.1.0" });
  const category = z.enum(CATEGORIES);

  server.registerTool(
    "search_news",
    {
      description:
        "Semantic search over condensed, source-linked news stories. Returns stories ranked by relevance with a score (higher is closer).",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        category: category.optional(),
        days: z.number().int().min(1).max(365).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ query, category: c, days, limit }) =>
      run("search_news", () =>
        searchResponse(deps, { q: query.trim(), ...(c ? { category: c } : {}), days: days ?? 30, limit: limit ?? 8 }, base),
      ),
  );

  server.registerTool(
    "latest_news",
    {
      description: "Most recently updated stories, optionally within one category.",
      inputSchema: z.object({
        category: category.optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ category: c, limit }) =>
      run("latest_news", () => latestResponse(deps, { ...(c ? { category: c } : {}), limit: limit ?? 20 }, base)),
  );

  server.registerTool(
    "get_story",
    {
      description: "One story by id, with all key facts and sources.",
      inputSchema: z.object({ id: z.string().min(1).max(64) }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      run("get_story", async () => {
        const s = await deps.stories.get(id);
        if (!s) throw new NotFound("story not found");
        return toPublicStory(s, base);
      }),
  );

  server.registerTool(
    "submit_information",
    {
      description:
        "Contribute factual information anonymously; an AI editor files it into a story or rejects it. Limited per network address per day.",
      inputSchema: z.object({
        text: z.string().min(20).max(20000),
        url: z.string().max(2048).optional(),
        title: z.string().max(300).optional(),
      }),
    },
    (args) => run("submit_information", () => submitContribution(deps, { ip, baseUrl: base }, args)),
  );

  return server;
}

/** Buffers a response body; null when it is still open after ms (a stream). */
async function readBody(res: Response, ms: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, ms);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }
  return timedOut ? null : Buffer.concat(chunks).toString("utf8");
}

async function respond(res: Response): Promise<HttpResult> {
  const body = await readBody(res, BODY_TIMEOUT_MS);
  if (body === null) {
    return json(405, { error: { code: "streaming_unsupported", message: "streaming responses are not supported" } });
  }
  return { statusCode: res.status, headers: Object.fromEntries(res.headers), body };
}

/** 2025-era stateless serving: one fresh server + transport per POST; GET/DELETE sessions don't exist. */
async function serveLegacy(server: McpServer, request: Request): Promise<HttpResult> {
  if (request.method !== "POST") {
    return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await respond(await transport.handleRequest(request));
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function handleMcp(event: APIGatewayProxyEventV2, deps: Deps, base: string): Promise<HttpResult> {
  const method = event.requestContext.http.method;
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (v !== undefined && k.toLowerCase() !== "content-length") headers.set(k, v);
  }
  const request = new Request(base + event.rawPath + (event.rawQueryString ? "?" + event.rawQueryString : ""), {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: bodyText(event) }),
  });

  const ip = event.requestContext.http.sourceIp;
  const factory = () => buildServer(deps, base, ip);
  if (await isLegacyRequest(request)) return serveLegacy(factory(), request);

  // Default responseMode "auto": a single JSON body unless a tool emits a message before its result (ours never do).
  const handler = createMcpHandler(factory, { legacy: "reject" });
  try {
    return await respond(await handler.fetch(request));
  } finally {
    await handler.close();
  }
}
