import { CATEGORIES, IP_DAILY_LIMIT } from "./config.ts";

export function renderLlmsTxt(base: string): string {
  return `# distributr

> Condensed, source-linked news stories maintained by an AI desk editor. Each story has a headline, a 2-4 sentence summary, atomic key facts, a category, named entities and links to every original source.

No authentication. All responses are JSON unless noted. Errors look like {"error":{"code","message"}}.

## Search and read

- [Semantic search](${base}/api/v1/search?q=central%20bank%20interest%20rates): GET ${base}/api/v1/search?q=<text> — params: q (required, 1-500 chars), category (optional), days (updated within, 1-365, default 30), limit (1-20, default 8). Returns {"query","category","days","results":[story + "score"]}; higher score is closer.
- [Latest stories](${base}/api/v1/stories): GET ${base}/api/v1/stories — params: category (optional), limit (1-50, default 20), cursor (from the previous page). Returns {"stories":[...],"cursor":string|null}, newest update first.
- [One story](${base}/api/v1/stories/{id}): GET ${base}/api/v1/stories/{id} — returns one story or 404.
- [Categories](${base}/api/v1/categories): GET ${base}/api/v1/categories — returns {"categories":[...]}.

Categories: ${CATEGORIES.join(", ")}.

Human-readable pages: ${base}/ (latest), ${base}/c/{category}, ${base}/search?q=, ${base}/s/{id}.

## MCP

- Endpoint: ${base}/mcp (Streamable HTTP, stateless, JSON responses; no auth)
- Tools: search_news(query, category?, days?, limit?), latest_news(category?, limit?), get_story(id), submit_information(text, url?, title?)

## Contribute (anonymous)

- POST ${base}/api/v1/submissions with content-type application/json and body {"text": "...", "url": "https://... (optional)", "title": "... (optional)"}.
- Limits: ${IP_DAILY_LIMIT} submissions per day per network address; text 20-20000 characters; url http(s) up to 2048 characters; title up to 300 characters. Exceeding a limit returns 429.
- An AI editor processes the submission synchronously. Outcomes: {"status":"created","storyId","storyUrl"} (new story), {"status":"merged","storyId","storyUrl"} (added to an existing story), or {"status":"rejected","reason"} (no verifiable factual information).
- Contributions are unverified: they are attributed to "Anonymous contributor" and never override facts from named sources.

## Story fields

- id, url (human-readable page)
- headline, summary, keyFacts (array of one-sentence facts)
- category, entities (array of names), eventDate (YYYY-MM-DD or null)
- sources (array of {name, kind: "feed"|"contributor", url?, title?, addedAt}), sourceCount
- corroboration: "multi-source" when at least two distinct source names back the story, else "single-source" (all anonymous contributions count as one source name)
- createdAt, updatedAt (ISO 8601)
`;
}
