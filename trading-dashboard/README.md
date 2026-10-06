# Trading Dashboard (Tradovate)

Watches all of your Tradovate accounts (funded and evals) on one page and checks each one against prop-firm rules.

## Run it

```bash
cd trading-dashboard
npm run mock      # fake data for 11 funded accounts and 6 evals, so you can see the UI
npm start         # real data once .env is filled in
```
Then open http://localhost:3000. You only need Node 18 or newer, with no `npm install`.

## Connect Tradovate

1. In Tradovate, go to **Application Settings → API Access** and create an API key. This gives you a `cid` and a `secret`. (Tradovate requires an API add-on subscription for this.)
2. `cp .env.example .env` and fill in your username, password, cid and secret.
3. Set `TRADOVATE_ENVS`. Evals and most prop-firm funded accounts are on `demo`. Use `demo,live` if you also have real-money accounts.

`.env` is gitignored and the server only listens on localhost. Your credentials never leave your machine except to go to Tradovate.

## Rules

`cp accounts.config.example.json accounts.config.json`, then edit it. `defaults` applies to every account. Under `accounts`, add an entry keyed by the exact Tradovate account name for anything that's different (for example evals and their profit targets).

| Field | Meaning |
|---|---|
| `type` | `eval` or `funded` |
| `startingBalance` | Account size |
| `trailingDrawdown` | Maximum trailing drawdown in $ |
| `drawdownMode` | `intraday` trails peak net liq, including open P&L. `eod` trails end-of-day balances. |
| `drawdownLocksAt` | The floor stops trailing at this value (Apex: start + 100). Use `null` if it never locks. |
| `dailyLossLimit` | $ per trading day. The day rolls at 5pm CT. Use `null` if there's none. |
| `profitTarget`, `minTradingDays` | Eval pass conditions |
| `maxContracts` | Maximum open contracts |
| `consistencyPct` | The best day can't be more than this % of total profit |
| `warnAtPct` | Shows a yellow warning once this % of a limit is used |

The high-water mark and daily P&L history are saved in `state.json`. Leave the dashboard running so it sees intraday peaks. It starts tracking from the first time it runs.
