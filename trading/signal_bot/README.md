# NQ/MNQ signal-only bot

Never places orders. Reads 1-minute bars, alerts on setups, and keeps a paper ledger.

Strategies (validated on 5 years of NQ 1m data):
- **Turn of month long**: last trading day + first 3 trading days of each month, buy 9:30 open, stop 0.5x ATR, exit 15:55.
- **London range breakout**: 3:00-9:30 ET range, stop entry on the break 9:30-11:30, stop 0.5x ATR, target 2R, exit 15:55.

## Run
```
pip install pandas pyarrow
export PROJECTX_USERNAME=... PROJECTX_API_KEY=... PROJECTX_CONTRACT=CON.F.US.MNQ.Z26
export ALERT_WEBHOOK=https://discord.com/api/webhooks/...   # optional
python signal_bot.py live            # run on a machine that stays on during market hours
python review.py signals.jsonl       # compare paper results with the backtest
```
Replay history (no network): `python signal_bot.py replay nq_ohlc.parquet 2025-01-01 2026-08-01`
