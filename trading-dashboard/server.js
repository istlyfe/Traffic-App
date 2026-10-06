// Tradovate multi-account dashboard: polls Tradovate, applies prop-firm rules, serves the UI.
// Zero dependencies — Node 18+ (built-in fetch).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, tradeDate } from './rules.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(DIR, '.env'));

const PORT = Number(process.env.PORT || 3000);
const POLL_MS = Number(process.env.POLL_SECONDS || 15) * 1000;
const MOCK = process.env.MOCK === '1' || !process.env.TRADOVATE_USERNAME;
const STATE_FILE = path.join(DIR, 'state.json');
const CONFIG_FILE = fs.existsSync(path.join(DIR, 'accounts.config.json'))
  ? path.join(DIR, 'accounts.config.json')
  : path.join(DIR, 'accounts.config.example.json');

const BASES = { demo: 'https://demo.tradovateapi.com/v1', live: 'https://live.tradovateapi.com/v1' };

let state = readJson(STATE_FILE, {});
let latest = { updatedAt: null, mock: MOCK, error: null, accounts: [] };

// ---------- Tradovate client ----------
const tokens = {}; // env -> { token, expires }

async function getToken(env) {
  const t = tokens[env];
  if (t && t.expires - Date.now() > 5 * 60_000) return t.token;
  const res = await fetch(`${BASES[env]}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name: process.env.TRADOVATE_USERNAME,
      password: process.env.TRADOVATE_PASSWORD,
      appId: process.env.TRADOVATE_APP_ID || 'TradingDashboard',
      appVersion: process.env.TRADOVATE_APP_VERSION || '1.0',
      cid: Number(process.env.TRADOVATE_CID),
      sec: process.env.TRADOVATE_SECRET,
      deviceId: process.env.TRADOVATE_DEVICE_ID || 'trading-dashboard-1',
    }),
  });
  const body = await res.json();
  if (body['p-ticket']) throw new Error(`Tradovate rate-limited login (p-ticket); retry in ${body['p-time']}s`);
  if (!body.accessToken) throw new Error(`Tradovate auth failed (${env}): ${body.errorText || res.status}`);
  tokens[env] = { token: body.accessToken, expires: new Date(body.expirationTime).getTime() };
  return body.accessToken;
}

async function tv(env, method, route, payload) {
  const res = await fetch(`${BASES[env]}${route}`, {
    method,
    headers: { Authorization: `Bearer ${await getToken(env)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) throw new Error(`${env} ${route} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchTradovate() {
  const envs = (process.env.TRADOVATE_ENVS || 'demo').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const env of envs) {
    const [accounts, positions] = await Promise.all([tv(env, 'GET', '/account/list'), tv(env, 'GET', '/position/list')]);
    for (const a of accounts.filter((x) => x.active !== false)) {
      const cash = await tv(env, 'POST', '/cashBalance/getcashbalancesnapshot', { accountId: a.id });
      const contracts = positions.filter((p) => p.accountId === a.id).reduce((n, p) => n + Math.abs(p.netPos || 0), 0);
      out.push({
        id: `${env}:${a.id}`, name: a.name, env,
        cashBalance: cash.totalCashValue ?? 0,
        openPnL: cash.openPnL ?? 0,
        realizedPnL: cash.realizedPnL ?? 0,
        openContracts: contracts,
      });
    }
  }
  return out;
}

// ---------- Mock data (11 funded + 6 evals) so the UI works before you connect ----------
const mockBook = [];
function fetchMock() {
  if (!mockBook.length) {
    for (let i = 1; i <= 17; i++) {
      const isEval = i > 11;
      mockBook.push({
        id: `mock:${i}`, name: `APEX-MOCK-${isEval ? 'EVAL' : 'PA'}-${String(i).padStart(2, '0')}`, env: 'demo',
        cashBalance: 50000 + (Math.random() - 0.3) * 3000, openPnL: 0, realizedPnL: 0, openContracts: 0,
      });
    }
  }
  for (const a of mockBook) {
    const d = (Math.random() - 0.48) * 120;
    a.cashBalance += d; a.realizedPnL += d;
    a.openContracts = Math.random() < 0.3 ? Math.ceil(Math.random() * 4) : 0;
    a.openPnL = a.openContracts ? (Math.random() - 0.5) * 300 : 0;
  }
  return mockBook.map((a) => ({ ...a }));
}

// ---------- Poll loop ----------
async function poll() {
  try {
    const config = readJson(CONFIG_FILE, { defaults: {}, accounts: {} });
    const raw = MOCK ? fetchMock() : await fetchTradovate();
    const today = tradeDate(new Date());
    latest = {
      updatedAt: new Date().toISOString(), mock: MOCK, error: null, tradeDate: today,
      accounts: raw.map((acct) => {
        const rules = { ...config.defaults, ...(config.accounts?.[acct.name] || {}) };
        if (MOCK && acct.name.includes('EVAL')) Object.assign(rules, { type: 'eval', profitTarget: 3000, consistencyPct: null, minTradingDays: 1 });
        const st = (state[acct.id] ||= {});
        return { ...acct, rules, ...evaluate(acct, rules, st, today) };
      }),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    latest = { ...latest, error: err.message };
    console.error('[poll]', err.message);
  }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(latest));
  }
  const file = path.join(DIR, 'public', req.url === '/' ? 'index.html' : path.normalize(req.url));
  if (!file.startsWith(path.join(DIR, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard on http://localhost:${PORT} (${MOCK ? 'MOCK data' : 'Tradovate'}; rules from ${path.basename(CONFIG_FILE)})`);
});

poll();
setInterval(poll, POLL_MS);

// ---------- helpers ----------
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }
function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
