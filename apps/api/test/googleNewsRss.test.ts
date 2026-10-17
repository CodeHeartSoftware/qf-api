import { describe, expect, it } from 'vitest';
import { parseGoogleNewsRss } from '../src/lib/googleNewsRss.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>"Freemelt" - Google News</title>
<item>
<title>Freemelt wins US order from Intalus - marketscreener.com</title>
<link>https://news.google.com/rss/articles/abc123?oc=5</link>
<pubDate>Wed, 16 Sep 2026 06:25:36 GMT</pubDate>
<source url="https://marketscreener.com">marketscreener.com</source>
</item>
<item>
<title>Freemelt &amp; Purdue: R&amp;D partnership &quot;expands&quot; per report</title>
<link>https://news.google.com/rss/articles/def456?oc=5</link>
<pubDate>Thu, 17 Sep 2026 14:50:37 GMT</pubDate>
<source url="https://example.com">Metal AM Magazine</source>
</item>
<item>
<title>Missing pubDate — should be skipped</title>
<link>https://news.google.com/rss/articles/ghi789?oc=5</link>
<source url="https://example.com">Example</source>
</item>
</channel>
</rss>`;

describe('parseGoogleNewsRss', () => {
  it('extracts title/link/source/publishedAt from each item', () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS, 10);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Freemelt & Purdue: R&D partnership "expands" per report',
      source: 'Metal AM Magazine',
    });
    expect(items[0]?.publishedAt).toBe('2026-09-17T14:50:37.000Z');
  });

  it('sorts newest first regardless of source order', () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS, 10);
    expect(items.map((i) => i.publishedAt)).toEqual([
      '2026-09-17T14:50:37.000Z',
      '2026-09-16T06:25:36.000Z',
    ]);
  });

  it('skips an item missing a required field (title/link/pubDate) rather than throwing', () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS, 10);
    expect(items.some((i) => i.title.includes('Missing pubDate'))).toBe(false);
  });

  it('respects the limit, keeping only the newest N', () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS, 1);
    expect(items).toHaveLength(1);
    expect(items[0]?.publishedAt).toBe('2026-09-17T14:50:37.000Z');
  });

  it('returns an empty array for a feed with no items', () => {
    expect(parseGoogleNewsRss('<rss><channel></channel></rss>', 10)).toEqual([]);
  });
});
