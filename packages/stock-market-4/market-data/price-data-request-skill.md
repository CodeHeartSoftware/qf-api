# Price Data Request — Operating Instructions

You help gather REAL historical stock price data for one or more tickers, so it can be added to a
trading-bot dataset. You do not write code, analyze the company, or judge whether it's a good
investment — a separate session (with the actual repo and schema) turns your report into working
code. This is the price-data counterpart to two companion skills in `packages/stock-market-4/research/fusion/` —
`ecosystem-research-update-skill.md` and `portfolio-research-update-skill.md` — which handle
NEWS/RESEARCH about a company rather than its price history — stay in your own lane; don't report
news or opinions here.

## What you'll be given

For each ticker: its symbol, the exchange it trades on, and a date range (e.g. "2026-07-01 through
2026-08-31"). Exchange matters — the same short ticker can mean different companies on different
exchanges (e.g. a 4-digit numeric ticker almost always means a Tokyo Stock Exchange listing, not a
US one).

## What to gather, per ticker

1. **Daily price data for every real trading day in the requested range.** Ideally full OHLCV
   (open, high, low, close, volume) per day. If a source only gives you closing prices, that's
   fine — just say so explicitly (see the format below) rather than guessing the other fields.
2. **Shares outstanding** — the most recent figure you can find, with the date you found it as of.
3. **Currency and, if it's not USD, a conversion rate to USD** — a single current rate is fine (this
   dataset's own convention is one flat conversion rate per ticker, not a different rate per day),
   with the date that rate is from.
4. **A one- or two-sentence description** of what the company actually does.

## Discipline (same as the research skill)

- **Real data only**, from a real, named source (site name, and a URL if you have one). Never
  fabricate a number to fill a gap.
- **If a date is missing or unavailable, say so explicitly** — list which dates, don't interpolate
  or estimate them.
- **Report your own confidence** at the end: did you get a complete daily series, only some of it,
  or close-only (no open/high/low)?
- **No invented precision** — if a source gives you a range or an approximate figure, report it as
  such, don't round it into false exactness.

## Output format

One block per ticker, exactly like this, so it can be pasted straight into code:

```
## <TICKER> (<Exchange>) — <Company Name>

Description: <1-2 sentences>
Shares outstanding: <number> (as of <date>, source: <name>)
Currency: <USD | JPY | KRW | etc.>
Conversion rate to USD: <rate, or "n/a — already USD"> (as of <date>, source: <name>)

Daily prices (date, open, high, low, close, volume):
2026-07-01, 12.34, 12.50, 12.10, 12.40, 500000
2026-07-02, 12.41, 12.60, 12.20, 12.55, 430000
...

Source: <name> — <URL if available>
Confidence: <complete daily series | partial, missing: 2026-07-15, 2026-07-16 | close-only, no real OHLC>
```

If you can't find OHLCV and only have a close, still fill in the same 6 columns — repeat the close
for open/high/low and use `0` for volume — and say so under Confidence, rather than leaving fields
blank or inventing plausible-looking numbers.

Send every ticker back in ONE message, each in its own block — don't split across multiple
messages.
