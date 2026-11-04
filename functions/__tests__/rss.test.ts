import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFeed } from "../shared/rss.ts";

test("RSS 2.0 single item: CDATA HTML stripped, guid object, link, date", () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>T</title>
<item>
  <title>Fed holds rates &amp; signals patience</title>
  <link>https://example.org/fed?a=1&amp;b=2</link>
  <guid isPermaLink="false">2026</guid>
  <description><![CDATA[<p>The <b>Federal Reserve</b> kept rates&nbsp;unchanged &#8212; again.</p>]]></description>
  <pubDate>Tue, 03 Nov 2026 18:00:00 GMT</pubDate>
</item>
</channel></rss>`;
  assert.deepEqual(parseFeed(xml), [
    {
      guid: "2026",
      title: "Fed holds rates & signals patience",
      link: "https://example.org/fed?a=1&b=2",
      summary: "The Federal Reserve kept rates unchanged — again.",
      publishedAt: new Date("2026-11-03T18:00:00Z"),
    },
  ]);
});

test("Atom entry: alternate link href, summary, published", () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
<entry>
  <id>urn:uuid:1234</id>
  <title type="text">Probe reaches orbit</title>
  <link rel="self" href="https://example.org/self"/>
  <link rel="alternate" href="https://example.org/probe"/>
  <summary type="html">&lt;p&gt;The probe entered orbit.&lt;/p&gt;</summary>
  <published>2026-11-02T10:00:00Z</published>
</entry>
</feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item?.guid, "urn:uuid:1234");
  assert.equal(item?.link, "https://example.org/probe");
  assert.equal(item?.title, "Probe reaches orbit");
  assert.equal(item?.summary, "The probe entered orbit.");
  assert.deepEqual(item?.publishedAt, new Date("2026-11-02T10:00:00Z"));
});

test("item with neither guid nor link is dropped; invalid date becomes undefined", () => {
  const xml = `<rss><channel>
<item><title>No identity</title><description>text</description></item>
<item><title>Kept</title><link>https://example.org/k</link><pubDate>not a date</pubDate></item>
</channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "Kept");
  assert.equal(items[0]?.publishedAt, undefined);
});
