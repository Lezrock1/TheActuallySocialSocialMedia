import { describe, expect, it } from "vitest";
import { parseNewsRss } from "./webSearch.js";

describe("parseNewsRss", () => {
  it("extracts headline, outlet, link and date", () => {
    const xml = `<rss><channel><item><title>Rates rise &amp; fall - Reuters</title>
      <link>https://news.example/a</link><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate>
      <source url="https://reuters.com">Reuters</source></item>
      <item><title>No link</title><link>javascript:alert(1)</link></item></channel></rss>`;
    expect(parseNewsRss(xml)).toEqual([
      { title: "Rates rise & fall", source: "Reuters", url: "https://news.example/a", date: "2026-10-28" },
    ]);
  });
});
