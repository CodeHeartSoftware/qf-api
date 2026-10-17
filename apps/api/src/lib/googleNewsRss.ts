/** A tiny, hand-rolled Google News RSS client — free, keyless, and searchable by plain company
 * name (which is what makes it work for the non-US tickers too, e.g. Furukawa/Fujikura/Sumitomo/
 * Vitzro Nextech, where a US-centric news API would have nothing). No XML library dependency:
 * Google's own RSS output is simple/consistent enough (a flat run of `<item>` blocks, no nested
 * namespaces this needs) that a few targeted regexes are more honest than a full parser for a
 * shape this narrow — same "don't reach for a dependency you don't need" instinct as this app's
 * hand-rolled force-directed graph layout. */

const ITEM_REGEX = /<item>([\s\S]*?)<\/item>/g;
const TITLE_REGEX = /<title>([\s\S]*?)<\/title>/;
const LINK_REGEX = /<link>([\s\S]*?)<\/link>/;
const PUB_DATE_REGEX = /<pubDate>([\s\S]*?)<\/pubDate>/;
const SOURCE_REGEX = /<source[^>]*>([\s\S]*?)<\/source>/;

function stripCdata(text: string): string {
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(text.trim());
  return match?.[1] ?? text;
}

function decodeXmlEntities(text: string): string {
  return stripCdata(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export interface NewsItem {
  title: string;
  /** Google's own redirect URL, not the publisher's canonical link — Google News RSS doesn't
   * expose the latter without following the redirect, and this still opens the real article fine
   * in a browser, which is all a "click to read" feed needs. */
  link: string;
  source: string;
  publishedAt: string;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; QuantFusionResearchNewsFeed/1.0)';

/** The parsing half, kept separate from the network fetch below so it's testable against a
 * canned RSS string — no real request needed to prove the regexes/entity-decoding are correct. */
export function parseGoogleNewsRss(xml: string, limit: number): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(ITEM_REGEX)) {
    const block = match[1] ?? '';
    const title = TITLE_REGEX.exec(block)?.[1];
    const link = LINK_REGEX.exec(block)?.[1];
    const pubDate = PUB_DATE_REGEX.exec(block)?.[1];
    const source = SOURCE_REGEX.exec(block)?.[1];
    if (title === undefined || link === undefined || pubDate === undefined) continue;
    const publishedAt = new Date(pubDate);
    if (Number.isNaN(publishedAt.getTime())) continue;
    items.push({
      title: decodeXmlEntities(title),
      link: decodeXmlEntities(link),
      source: source !== undefined ? decodeXmlEntities(source) : 'Google News',
      publishedAt: publishedAt.toISOString(),
    });
  }

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
}

/** Fetches and parses one Google News RSS search, newest first, capped at `limit`. Throws on a
 * genuine network/HTTP failure — the caller (one call per tracked ticker) decides whether that
 * should fail the whole request or just that one ticker's slice of it. */
export async function fetchGoogleNews(query: string, limit: number): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Google News RSS request failed with status ${String(res.status)}`);
  }
  const xml = await res.text();
  return parseGoogleNewsRss(xml, limit);
}
