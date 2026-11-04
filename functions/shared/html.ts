/**
 * Minimal server-rendered pages. Every LLM-derived or submitted value goes
 * through escapeHtml; every external href goes through safeHttpUrl.
 */
import { CATEGORIES, IP_DAILY_LIMIT } from "./config.ts";
import { safeHttpUrl } from "./story.ts";
import type { PublicStory, SubmissionResponse } from "./types.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const CSS = `
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; line-height: 1.5; max-width: 46rem; margin: 0 auto; padding: 1rem; }
header { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between; }
header .home { font-weight: 700; font-size: 1.25rem; text-decoration: none; color: inherit; }
header form { display: flex; gap: .25rem; flex: 1; max-width: 24rem; }
header input { flex: 1; }
nav { display: flex; flex-wrap: wrap; gap: .25rem .75rem; margin: .75rem 0 1.5rem; font-size: .9rem; }
article { margin: 1.5rem 0; }
article h2 { font-size: 1.15rem; margin: 0 0 .25rem; }
.meta { font-size: .85rem; opacity: .7; margin: 0 0 .25rem; }
.error { color: #c62828; font-weight: 600; }
label { display: block; margin: .75rem 0; }
input, textarea, select, button { font: inherit; }
textarea { width: 100%; min-height: 10rem; box-sizing: border-box; }
form.wide input:not([type=submit]) { width: 100%; box-sizing: border-box; }
footer { margin-top: 3rem; padding-top: .75rem; border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); font-size: .85rem; opacity: .7; }
`;

function layout(p: { title: string; description?: string; body: string; alternateJson?: string; q?: string }): string {
  const nav = CATEGORIES.map((c) => `<a href="/c/${c}">${c}</a>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
${p.description ? `<meta name="description" content="${escapeHtml(p.description)}">\n` : ""}<link rel="alternate" type="text/plain" href="/llms.txt">
${p.alternateJson ? `<link rel="alternate" type="application/json" href="${escapeHtml(p.alternateJson)}">\n` : ""}<style>${CSS}</style>
</head>
<body>
<header>
<a class="home" href="/">distributr</a>
<form method="get" action="/search" role="search"><input name="q" type="search" placeholder="Search stories" value="${escapeHtml(p.q ?? "")}" maxlength="500"><button>Search</button></form>
<a href="/contribute">Contribute</a>
</header>
<nav>${nav}</nav>
<main>
${p.body}
</main>
<footer>For AI agents: <a href="/llms.txt">/llms.txt</a> · /api/v1/search?q= · MCP /mcp</footer>
</body>
</html>
`;
}

function metaLine(s: PublicStory): string {
  const n = s.sourceCount;
  return `<p class="meta">${escapeHtml(s.category)} · updated ${escapeHtml(s.updatedAt.slice(0, 10))} · ${n} ${n === 1 ? "source" : "sources"} · ${s.corroboration}</p>`;
}

function storyList(stories: PublicStory[], empty: string): string {
  if (stories.length === 0) return `<p>${escapeHtml(empty)}</p>`;
  return stories
    .map(
      (s) => `<article>
<h2><a href="/s/${encodeURIComponent(s.id)}">${escapeHtml(s.headline)}</a></h2>
${metaLine(s)}
<p>${escapeHtml(s.summary)}</p>
</article>`,
    )
    .join("\n");
}

export function homePage(stories: PublicStory[]): string {
  return layout({
    title: "distributr — latest stories",
    description: "Condensed, source-linked news stories maintained by an AI desk editor.",
    body: `<h1>Latest</h1>\n${storyList(stories, "No stories yet.")}`,
  });
}

export function categoryPage(category: string, stories: PublicStory[]): string {
  return layout({
    title: `distributr — ${category}`,
    body: `<h1>${escapeHtml(category)}</h1>\n${storyList(stories, "No stories in this category yet.")}`,
  });
}

export function searchPage(p: { q: string; category?: string; results?: PublicStory[]; error?: string }): string {
  const options = ['<option value="">all categories</option>']
    .concat(CATEGORIES.map((c) => `<option value="${c}"${c === p.category ? " selected" : ""}>${c}</option>`))
    .join("");
  const form = `<form method="get" action="/search">
<input name="q" type="search" value="${escapeHtml(p.q)}" maxlength="500" required>
<select name="category">${options}</select>
<button>Search</button>
</form>`;
  let body = `<h1>Search</h1>\n${form}`;
  if (p.error) body += `\n<p class="error" role="alert">${escapeHtml(p.error)}</p>`;
  if (p.results) body += `\n${storyList(p.results, "No matching stories.")}`;
  return layout({ title: p.q ? `distributr — search: ${p.q}` : "distributr — search", body, q: p.q });
}

export function storyPage(s: PublicStory): string {
  const facts = s.keyFacts.map((f) => `<li>${escapeHtml(f)}</li>`).join("\n");
  const sources = s.sources
    .map((src) => {
      const label = escapeHtml(src.title ? `${src.name} — ${src.title}` : src.name);
      const href = safeHttpUrl(src.url);
      const contributor = src.kind === "contributor";
      const link = href
        ? `<a href="${escapeHtml(href)}" rel="${contributor ? "nofollow ugc noopener" : "noopener"}">${label}</a>`
        : label;
      const note = href && contributor ? "link provided by contributor · " : "";
      return `<li>${link} <span class="meta">${note}added ${escapeHtml(src.addedAt.slice(0, 10))}</span></li>`;
    })
    .join("\n");
  const body = `<article>
<h1>${escapeHtml(s.headline)}</h1>
${metaLine(s)}${s.eventDate ? `\n<p class="meta">event date ${escapeHtml(s.eventDate)}</p>` : ""}
<p>${escapeHtml(s.summary)}</p>
<h2>Key facts</h2>
<ul>
${facts}
</ul>
${s.entities.length ? `<p><strong>Entities:</strong> ${escapeHtml(s.entities.join(", "))}</p>\n` : ""}<h2>Sources</h2>
<ol>
${sources}
</ol>
</article>`;
  return layout({
    title: s.headline,
    description: s.summary,
    body,
    alternateJson: `/api/v1/stories/${encodeURIComponent(s.id)}`,
  });
}

export function contributePage(p: { error?: string; values?: { text: string; url: string; title: string } }): string {
  const v = p.values ?? { text: "", url: "", title: "" };
  const body = `<h1>Contribute</h1>
<p>Contributions are anonymous, rewritten by an AI editor, may be rejected, and are limited to ${IP_DAILY_LIMIT} per day per network address. Do not include personal data.</p>
${p.error ? `<p class="error" role="alert">${escapeHtml(p.error)}</p>\n` : ""}<form class="wide" method="post" action="/contribute">
<label>What happened? (facts, with dates, names and places)
<textarea name="text" required minlength="20" maxlength="20000">${escapeHtml(v.text)}</textarea></label>
<label>Source URL (optional)
<input name="url" type="url" maxlength="2048" value="${escapeHtml(v.url)}"></label>
<label>Title (optional)
<input name="title" maxlength="300" value="${escapeHtml(v.title)}"></label>
<button>Submit</button>
</form>`;
  return layout({ title: "distributr — contribute", body });
}

export function contributeResultPage(r: SubmissionResponse): string {
  const body =
    r.status === "rejected"
      ? `<h1>Not filed</h1>
<p>The editor rejected this: ${escapeHtml(r.reason)}</p>
<p><a href="/contribute">Contribute something else</a></p>`
      : `<h1>Thanks</h1>
<p>Filed into story: <a href="/s/${encodeURIComponent(r.storyId)}">${escapeHtml(r.storyUrl)}</a> (${r.status === "created" ? "new story" : "merged into an existing story"})</p>`;
  return layout({ title: "distributr — contribution", body });
}

export function errorPage(status: number, message: string): string {
  return layout({ title: `distributr — ${status}`, body: `<h1>${status}</h1>\n<p>${escapeHtml(message)}</p>` });
}
