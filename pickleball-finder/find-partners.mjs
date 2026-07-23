#!/usr/bin/env node
// find-partners.mjs
// Scan public online sources for people looking for a pickleball partner
// in South Florida. Zero dependencies — uses Node 18+ built-in fetch.
//
// Usage:
//   node find-partners.mjs                 # last 30 days, pretty print
//   node find-partners.mjs --days 14       # only posts from last 14 days
//   node find-partners.mjs --min-score 3   # only stronger matches
//   node find-partners.mjs --city boca     # narrow to one area
//   node find-partners.mjs --json out.json # also write JSON
//   node find-partners.mjs --md out.md     # also write a Markdown report
//
// Notes:
//   - Only reads PUBLIC data (Reddit's public search JSON). No login, no
//     scraping behind auth, no messaging anyone. It just finds candidate
//     posts and hands you the links so YOU can reach out like a human.
//   - Be polite: this respects a rate-limit delay between requests.

const UA = 'pickleball-partner-finder/1.0 (personal use; polite scraper)';

// Optional: a free Reddit "script" app makes requests far more reliable
// (anonymous JSON is often blocked from datacenter/VPN IPs with a 403).
// Create one at https://www.reddit.com/prefs/apps  → "script" type, then:
//   export REDDIT_CLIENT_ID=xxxx
//   export REDDIT_CLIENT_SECRET=yyyy
// No username/password needed — we use app-only (client_credentials) auth.
const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } = process.env;
let ACCESS_TOKEN = null;

async function getToken() {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  const basic = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) { console.warn(`  ! auth failed (${res.status}); falling back to anonymous`); return null; }
  const j = await res.json();
  ACCESS_TOKEN = j.access_token;
  console.log('  ✓ authenticated with Reddit app credentials\n');
  return ACCESS_TOKEN;
}

// Host to hit: authenticated oauth host, else public host.
function apiHost() { return ACCESS_TOKEN ? 'https://oauth.reddit.com' : 'https://www.reddit.com'; }

// ---------------------------------------------------------------------------
// What "South Florida" and "looking for a partner" mean, in keywords.
// ---------------------------------------------------------------------------

// Subreddits worth searching. Local ones + the pickleball hubs.
const SUBREDDITS = [
  'Pickleball',
  'SouthFlorida',
  'Miami',
  'fortlauderdale',
  'BrowardCounty',
  'BocaRaton',
  'WestPalmBeach',
  'PalmBeach',
  'Naples',
  'Sarasota',
  'weston',
  'Hollywood',
  'Kendall',
];

// Location terms. Grouped by area so `--city` can narrow the net.
const LOCATIONS = {
  miami: ['miami', 'brickell', 'coral gables', 'kendall', 'doral', 'aventura', 'wynwood', 'south beach'],
  broward: ['fort lauderdale', 'ft lauderdale', 'broward', 'hollywood fl', 'pembroke pines', 'weston', 'coral springs', 'plantation', 'davie', 'sunrise'],
  boca: ['boca raton', 'boca', 'delray', 'delray beach', 'boynton'],
  palm: ['west palm', 'palm beach', 'jupiter', 'wellington', 'lake worth'],
  naples: ['naples', 'bonita springs', 'fort myers', 'ft myers', 'cape coral'],
  general: ['south florida', 'sofla', 'sflorida', 'tri-county', 'treasure coast'],
};

// Phrases that signal someone wants a hitting partner / group.
const PARTNER_TERMS = [
  'looking for a partner', 'looking for partner', 'need a partner', 'hitting partner',
  'looking for someone to play', 'anyone want to play', 'anyone wanna play',
  'partner search', 'looking for players', 'looking for a group', 'find a partner',
  'lft', 'looking for team', 'looking for a game', 'want to play', 'looking to play',
  'anyone down to play', 'anyone free to play', 'need players', 'partner wanted',
  'dupr', 'rec play', 'open play', 'looking for a hitting',
];

// Reject obvious noise (leagues selling stuff, coaching ads, unrelated "partner").
const NEGATIVE_TERMS = [
  'business partner', 'affiliate', 'wholesale', 'coupon code', 'discount code',
  'law firm', 'accident attorney',
];

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { days: 30, minScore: 2, city: null, json: null, md: null, limitPerSub: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--min-score') args.minScore = Number(argv[++i]);
    else if (a === '--city') args.city = String(argv[++i]).toLowerCase();
    else if (a === '--json') args.json = argv[++i] || 'pickleball-results.json';
    else if (a === '--md') args.md = argv[++i] || 'pickleball-results.md';
    else if (a === '--limit') args.limitPerSub = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`
Pickleball Partner Finder (South Florida)

  node find-partners.mjs [options]

  --days N        Only posts from the last N days       (default 30)
  --min-score N   Only show matches scoring >= N         (default 2)
  --city NAME     Narrow to one area: ${Object.keys(LOCATIONS).join(', ')}
  --json [FILE]   Also write results as JSON             (default pickleball-results.json)
  --md   [FILE]   Also write a Markdown report           (default pickleball-results.md)
  --limit N       Max posts fetched per subreddit        (default 100)
  --help          Show this help
`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function activeLocations(city) {
  if (!city) return Object.values(LOCATIONS).flat();
  if (LOCATIONS[city]) return LOCATIONS[city].concat(LOCATIONS.general);
  // Allow partial like "boca" matching a key, or a raw term.
  const key = Object.keys(LOCATIONS).find((k) => k.startsWith(city));
  if (key) return LOCATIONS[key].concat(LOCATIONS.general);
  return [city].concat(LOCATIONS.general);
}

async function fetchJson(path) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
  const res = await fetch(`${apiHost()}${path}`, { headers });
  if (res.status === 429) throw new Error('rate-limited (429) — slow down or try again later');
  if (res.status === 403 && !ACCESS_TOKEN) {
    throw new Error('403 blocked (this IP is likely rate-limited by Reddit — set REDDIT_CLIENT_ID/SECRET for reliable access)');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Search one subreddit for the partner terms, restricted to that sub.
async function searchSubreddit(sub, days, limit) {
  const q = encodeURIComponent('pickleball partner OR "looking to play" OR "hitting partner" OR play');
  const t = days <= 7 ? 'week' : days <= 31 ? 'month' : 'year';
  const path = `/r/${sub}/search.json?q=${q}&restrict_sr=1&sort=new&limit=${limit}&t=${t}`;
  try {
    const data = await fetchJson(path);
    return (data?.data?.children || []).map((c) => c.data);
  } catch (e) {
    console.warn(`  ! r/${sub}: ${e.message}`);
    return [];
  }
}

// A broad site-wide search catches local subs we didn't list.
async function searchGlobal(days, limit) {
  const q = encodeURIComponent('pickleball partner "south florida" OR miami OR "fort lauderdale" OR boca');
  const t = days <= 7 ? 'week' : days <= 31 ? 'month' : 'year';
  const path = `/search.json?q=${q}&sort=new&limit=${limit}&t=${t}`;
  try {
    const data = await fetchJson(path);
    return (data?.data?.children || []).map((c) => c.data);
  } catch (e) {
    console.warn(`  ! global search: ${e.message}`);
    return [];
  }
}

function scorePost(post, locations) {
  const hay = `${post.title || ''}\n${post.selftext || ''}`.toLowerCase();
  let score = 0;
  const reasons = [];

  const locHits = locations.filter((l) => hay.includes(l));
  if (locHits.length) { score += 2 + Math.min(locHits.length - 1, 2); reasons.push(`location: ${locHits.slice(0, 3).join(', ')}`); }

  const partnerHits = PARTNER_TERMS.filter((p) => hay.includes(p));
  if (partnerHits.length) { score += 2 + Math.min(partnerHits.length - 1, 2); reasons.push(`intent: ${partnerHits.slice(0, 3).join(', ')}`); }

  // "pickleball" mentioned at all is a small nudge (subs like r/Miami need it).
  if (hay.includes('pickleball') || hay.includes('pickle ball')) { score += 1; }
  else { score -= 2; } // if the word isn't there, probably not our post

  if (NEGATIVE_TERMS.some((n) => hay.includes(n))) { score -= 4; reasons.push('penalized: off-topic term'); }

  // Fresh posts are more actionable.
  const ageDays = (Date.now() / 1000 - (post.created_utc || 0)) / 86400;
  if (ageDays <= 3) score += 1;

  return { score, reasons, ageDays };
}

function fmtAge(days) {
  if (days < 1) return `${Math.round(days * 24)}h ago`;
  if (days < 30) return `${Math.round(days)}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const locations = activeLocations(args.city);

  await getToken(); // no-op unless REDDIT_CLIENT_ID/SECRET are set

  console.log(`\n🎾  Searching for pickleball partners in ${args.city ? args.city.toUpperCase() : 'South Florida'}`);
  console.log(`    window: last ${args.days} days · min score: ${args.minScore}\n`);

  const seen = new Map(); // id -> post
  const collect = (posts) => { for (const p of posts) if (p && p.id) seen.set(p.id, p); };

  for (const sub of SUBREDDITS) {
    process.stdout.write(`  · r/${sub} ... `);
    const posts = await searchSubreddit(sub, args.days, args.limitPerSub);
    console.log(`${posts.length} posts`);
    collect(posts);
    await sleep(1200); // be polite to Reddit
  }
  process.stdout.write('  · site-wide ... ');
  const global = await searchGlobal(args.days, args.limitPerSub);
  console.log(`${global.length} posts`);
  collect(global);

  const cutoff = Date.now() / 1000 - args.days * 86400;
  const results = [];
  for (const post of seen.values()) {
    if ((post.created_utc || 0) < cutoff) continue;
    const { score, reasons, ageDays } = scorePost(post, locations);
    if (score < args.minScore) continue;
    results.push({
      score,
      reasons,
      ageDays,
      title: post.title,
      subreddit: post.subreddit,
      author: post.author,
      url: `https://www.reddit.com${post.permalink}`,
      created: new Date((post.created_utc || 0) * 1000).toISOString(),
      snippet: (post.selftext || '').replace(/\s+/g, ' ').slice(0, 240),
    });
  }

  results.sort((a, b) => b.score - a.score || a.ageDays - b.ageDays);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Found ${results.length} likely matches\n`);
  for (const r of results) {
    console.log(`  [${r.score}] ${r.title}`);
    console.log(`       r/${r.subreddit} · u/${r.author} · ${fmtAge(r.ageDays)}`);
    console.log(`       ${r.url}`);
    if (r.snippet) console.log(`       “${r.snippet}${r.snippet.length >= 240 ? '…' : ''}”`);
    console.log('');
  }
  if (!results.length) {
    console.log('  Nothing matched. Try: --days 90, a lower --min-score, or drop --city.\n');
  }

  if (args.json) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(args.json, JSON.stringify(results, null, 2));
    console.log(`  → wrote ${args.json}`);
  }
  if (args.md) {
    const { writeFile } = await import('node:fs/promises');
    const lines = [
      `# Pickleball partners — ${args.city ? args.city : 'South Florida'}`,
      `_Generated ${new Date().toISOString()} · last ${args.days} days · ${results.length} matches_`,
      '',
    ];
    for (const r of results) {
      lines.push(`### [${r.score}] [${r.title}](${r.url})`);
      lines.push(`r/${r.subreddit} · u/${r.author} · ${fmtAge(r.ageDays)}  `);
      if (r.snippet) lines.push(`> ${r.snippet}`);
      lines.push('');
    }
    await writeFile(args.md, lines.join('\n'));
    console.log(`  → wrote ${args.md}`);
  }
  console.log('');
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
