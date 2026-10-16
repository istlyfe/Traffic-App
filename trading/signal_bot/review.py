"""Compare the signal ledger with backtest expectations.  Usage: python review.py [signals.jsonl]"""
import json
import sys

import pandas as pd

EXPECT = {"TOM": (0.52, 28.3), "LONDON": (0.48, 9.4)}   # (win rate, avg pts/trade) from the 5y backtest

path = sys.argv[1] if len(sys.argv) > 1 else "signals.jsonl"
rows = [json.loads(l) for l in open(path)]
c = pd.DataFrame([r for r in rows if r["event"] == "close"])
if c.empty:
    sys.exit("no closed signals yet")
c["closed"] = pd.to_datetime(c["closed"], utc=True)
for name, g in c.groupby("name"):
    win, avg = EXPECT.get(name, (None, None))
    print(f"{name:7} n={len(g):4}  win {(g.pts > 0).mean():.0%} (backtest {win:.0%})  "
          f"avg {g.pts.mean():+6.1f} pts (backtest {avg:+.1f})  total ${g.usd.sum():+,.0f}")
m = c.set_index("closed").usd.resample("ME").sum()
print("\nPaper P&L by month ($):")
print(m.round(0).to_string())
