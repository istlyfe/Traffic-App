# 🎾 Pickleball Partner Finder — South Florida

A tiny, zero-dependency Node script that scans **public** Reddit posts for people
looking for a pickleball partner / group in South Florida, scores them by
relevance + recency, and hands you the links so you can reach out yourself.

It does **not** message anyone, log in on your behalf, or scrape anything behind
a login. It just finds candidate posts and prints them.

## Requirements

- Node 18+ (uses built-in `fetch`). No `npm install` needed.

## Usage

```bash
cd pickleball-finder

node find-partners.mjs                  # last 30 days, South Florida
node find-partners.mjs --days 90        # widen the time window
node find-partners.mjs --city boca      # narrow to Boca / Delray area
node find-partners.mjs --min-score 4    # only the strongest matches
node find-partners.mjs --md report.md   # also write a Markdown report
node find-partners.mjs --json out.json  # also write JSON
```

Areas for `--city`: `miami`, `broward`, `boca`, `palm`, `naples`, `general`.

## Reliable access (recommended)

Anonymous Reddit JSON is frequently **blocked (403)** from datacenter, VPN, or
cloud IPs. If you hit that, create a free Reddit app for stable access:

1. Go to <https://www.reddit.com/prefs/apps> → **create app** → type **script**.
2. Copy the client ID (under the app name) and the secret.
3. Export them, then run:

```bash
export REDDIT_CLIENT_ID=your_client_id
export REDDIT_CLIENT_SECRET=your_secret
node find-partners.mjs
```

The script uses app-only (`client_credentials`) auth — no username/password, no
account access beyond reading public listings.

## How it scores

Each post gets points for:

- **Location match** — South Florida city terms in the title/body.
- **Intent match** — phrases like "looking for a partner", "hitting partner",
  "anyone want to play", "DUPR", "open play", etc.
- **Freshness** — recent posts rank higher.

Posts without "pickleball" mentioned, or with off-topic terms (business partner,
attorney ads, etc.), are penalized. Tune the keyword lists at the top of
`find-partners.mjs` to taste.

## Ideas / extending

- Add more sources (Meetup groups, Facebook groups, forum sites) as new
  `searchX()` functions that return `{title, selftext, permalink, created_utc}`.
- Run it on a schedule (cron) and diff against a saved JSON to get only *new*
  posts each day.

## Etiquette & legality

Reads only public data, one polite request at a time (rate-limited). Respect
each site's Terms of Service and `robots.txt`, don't spam replies, and reach out
like a normal human. This is meant to help you *find* people to play with — the
actual "hey, want to hit this weekend?" is on you. 🎾
