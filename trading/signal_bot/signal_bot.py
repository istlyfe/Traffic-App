"""Signal-only NQ/MNQ bot: turn-of-month long + London range breakout.

It NEVER places orders. It reads 1-minute bars (ProjectX market data, read-only), works out the
setups, sends alerts (console + optional Discord/Telegram webhook), and keeps a paper ledger of how
each signal would have played out so live results can be compared with the 5-year backtest.

Usage:
    python signal_bot.py live                       # poll ProjectX every minute
    python signal_bot.py replay path/to/nq1m.parquet [start] [end]   # replay history, no network

Environment:
    PROJECTX_USERNAME, PROJECTX_API_KEY   ProjectX credentials (read-only data use)
    PROJECTX_CONTRACT                     e.g. CON.F.US.MNQ.Z26
    ALERT_WEBHOOK                         optional Discord webhook URL
    TELEGRAM_TOKEN, TELEGRAM_CHAT_ID      optional Telegram alerts
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

import pandas as pd

TZ = "America/New_York"
POINT_VALUE = 2.0          # MNQ $/point (NQ = 20)
COST_PTS = 0.75            # commission + slippage per round trip, in points
ATR_LEN = 14
CFG = {
    "tom":    {"enabled": True, "size": 2, "stop_atr": 0.5, "first_n": 3, "last_day": True},
    "london": {"enabled": True, "size": 2, "stop_atr": 0.5, "rr": 2.0, "start": 570, "end": 690},
    "flat_minute": 955,    # 15:55 ET
}
LEDGER = os.environ.get("SIGNAL_LEDGER", "signals.jsonl")


# ---------------------------------------------------------------- alerts
def alert(text):
    print(text, flush=True)
    hook = os.environ.get("ALERT_WEBHOOK")
    if hook:
        _post_json(hook, {"content": text})
    tok, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if tok and chat:
        _post_json(f"https://api.telegram.org/bot{tok}/sendMessage", {"chat_id": chat, "text": text})


def _post_json(url, body):
    try:
        req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:  # alerts must never crash the bot
        print(f"[alert delivery failed: {e}]", flush=True)


def record(event):
    with open(LEDGER, "a") as f:
        f.write(json.dumps(event, default=str) + "\n")


# ---------------------------------------------------------------- market data (read-only)
class ProjectXData:
    BASE = os.environ.get("PROJECTX_API_BASE", "https://api.topstepx.com/api/")

    def __init__(self):
        self.token = None

    def _post(self, path, body, auth=True):
        hdr = {"Content-Type": "application/json"}
        if auth:
            hdr["Authorization"] = "Bearer " + self.token
        for attempt in range(6):
            try:
                req = urllib.request.Request(self.BASE + path, json.dumps(body).encode(), hdr)
                return json.load(urllib.request.urlopen(req, timeout=30))
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(2 ** attempt)
                    continue
                if e.code == 401 and auth:
                    self.login()
                    hdr["Authorization"] = "Bearer " + self.token
                    continue
                raise
        raise RuntimeError("rate limited")

    def login(self):
        r = self._post("Auth/loginKey", {"userName": os.environ["PROJECTX_USERNAME"],
                                         "apiKey": os.environ["PROJECTX_API_KEY"]}, auth=False)
        if not r.get("success"):
            raise RuntimeError(f"login failed (errorCode {r.get('errorCode')})")
        self.token = r["token"]

    def bars(self, start, end):
        r = self._post("History/retrieveBars", {
            "contractId": os.environ.get("PROJECTX_CONTRACT", "CON.F.US.MNQ.Z26"), "live": False,
            "startTime": start.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": end.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
            "unit": 2, "unitNumber": 1, "limit": 20000, "includePartialBar": False})
        df = pd.DataFrame(r.get("bars") or [])
        if df.empty:
            return df
        df["t"] = pd.to_datetime(df["t"], utc=True).dt.tz_convert(TZ)
        return df.rename(columns={"c": "cl"}).set_index("t").sort_index()[["o", "h", "l", "cl"]]


# ---------------------------------------------------------------- signal engine
class Engine:
    """Feed it completed 1-minute bars in order; it emits signals and tracks paper trades."""

    def __init__(self):
        self.ranges = []           # completed RTH ranges (for ATR)
        self.td = None
        self.month_days = {}       # (year, month) -> trading days seen
        self.reset_day()

    def reset_day(self):
        self.rth_h = self.rth_l = None
        self.lon_h = self.lon_l = None
        self.tom_done = self.lon_done = False
        self.tom_today = False
        self.pending = []          # london stop entries armed
        self.open = []             # open paper trades

    @property
    def atr(self):
        return sum(self.ranges[-ATR_LEN:]) / ATR_LEN if len(self.ranges) >= ATR_LEN else None

    def on_bar(self, t, o, h, l, c):
        m = t.hour * 60 + t.minute
        td = (t + pd.Timedelta(hours=6)).date()
        if td != self.td:
            self._close_all(t, o, "session end")
            if self.rth_h is not None:
                self.ranges.append(self.rth_h - self.rth_l)
            self.td = td
            self.reset_day()
            key = (td.year, td.month)
            self.month_days[key] = self.month_days.get(key, 0) + 1 if td.weekday() < 5 else self.month_days.get(key, 0)
            nxt = pd.Timestamp(td) + pd.Timedelta(days=3 if td.weekday() == 4 else 1)
            day_n = self.month_days[key]
            c_tom = CFG["tom"]
            self.tom_today = td.weekday() < 5 and (day_n <= c_tom["first_n"] or (c_tom["last_day"] and nxt.month != td.month))

        # update open paper trades with this bar
        self._manage(t, h, l)

        if 180 <= m < 570:
            self.lon_h = h if self.lon_h is None else max(self.lon_h, h)
            self.lon_l = l if self.lon_l is None else min(self.lon_l, l)
        if 570 <= m < 960:
            self.rth_h = h if self.rth_h is None else max(self.rth_h, h)
            self.rth_l = l if self.rth_l is None else min(self.rth_l, l)

        atr = self.atr
        # ---- turn of month: buy the 9:30 open
        if m == 570 and CFG["tom"]["enabled"] and self.tom_today and not self.tom_done and atr:
            self.tom_done = True
            stop = o - CFG["tom"]["stop_atr"] * atr
            self._open(t, "TOM", 1, o, stop, None, CFG["tom"]["size"])

        # ---- London breakout: arm at 9:30, trigger on break during 9:30-11:30
        cl = CFG["london"]
        if cl["enabled"] and m == cl["start"] and atr and self.lon_h is not None and not self.lon_done:
            risk = cl["stop_atr"] * atr
            self.pending = [("LONDON", 1, self.lon_h, risk), ("LONDON", -1, self.lon_l, risk)]
            alert(f"[{t:%Y-%m-%d %H:%M}] LONDON armed: buy stop {self.lon_h:.2f} / sell stop {self.lon_l:.2f}, "
                  f"stop {risk:.1f} pts, target {cl['rr'] * risk:.1f} pts, {cl['size']} MNQ")
        if self.pending and not self.lon_done and cl["start"] <= m < cl["end"]:
            for name, side, lvl, risk in self.pending:
                hit = (side == 1 and h > lvl and o <= lvl) or (side == -1 and l < lvl and o >= lvl)
                if hit:
                    self.lon_done = True
                    self.pending = []
                    self._open(t, name, side, lvl, lvl - side * risk, lvl + side * cl["rr"] * risk, cl["size"])
                    break
        if m >= cl["end"] and self.pending:
            self.pending = []
            alert(f"[{t:%Y-%m-%d %H:%M}] LONDON window closed, no trigger")

        if m >= CFG["flat_minute"]:
            self._close_all(t, c, "15:55 flat")

    # -------------------------------------------------- paper ledger
    def _open(self, t, name, side, entry, stop, target, size):
        tr = dict(name=name, side=side, entry=entry, stop=stop, target=target, size=size, opened=t)
        self.open.append(tr)
        tgt = f"{target:.2f}" if target else "none (exit 15:55)"
        alert(f"[{t:%Y-%m-%d %H:%M}] SIGNAL {name} {'LONG' if side == 1 else 'SHORT'} {size} MNQ @ {entry:.2f} | "
              f"stop {stop:.2f} | target {tgt} | risk ${abs(entry - stop) * POINT_VALUE * size:.0f}")
        record({"event": "open", **tr})

    def _manage(self, t, h, l):
        for tr in list(self.open):
            s = tr["side"]
            if (s == 1 and l <= tr["stop"]) or (s == -1 and h >= tr["stop"]):
                self._close(tr, t, tr["stop"], "stop")
            elif tr["target"] and ((s == 1 and h >= tr["target"]) or (s == -1 and l <= tr["target"])):
                self._close(tr, t, tr["target"], "target")

    def _close_all(self, t, price, why):
        for tr in list(self.open):
            self._close(tr, t, price, why)

    def _close(self, tr, t, price, why):
        self.open.remove(tr)
        pts = tr["side"] * (price - tr["entry"]) - COST_PTS
        usd = pts * POINT_VALUE * tr["size"]
        alert(f"[{t:%Y-%m-%d %H:%M}] EXIT {tr['name']} @ {price:.2f} ({why}) -> {pts:+.1f} pts, ${usd:+.0f}")
        record({"event": "close", "name": tr["name"], "side": tr["side"], "entry": tr["entry"], "exit": price,
                "why": why, "pts": pts, "usd": usd, "opened": tr["opened"], "closed": t})


# ---------------------------------------------------------------- runners
def replay(path, start=None, end=None):
    df = pd.read_parquet(path)
    if start:
        df = df[df.index >= pd.Timestamp(start, tz=TZ) - pd.Timedelta(days=40)]
    if end:
        df = df[df.index < pd.Timestamp(end, tz=TZ)]
    eng = Engine()
    quiet = start is not None
    global alert
    real_alert = alert
    for t, r in df.iterrows():
        if quiet and t < pd.Timestamp(start, tz=TZ):
            alert = lambda *_: None   # warm-up: build ATR silently
        else:
            alert = real_alert
        eng.on_bar(t, r.o, r.h, r.l, r.cl)
    alert = real_alert


def live():
    src = ProjectXData()
    src.login()
    eng = Engine()
    now = pd.Timestamp.now(tz=TZ).floor("min")
    hist = src.bars(now - pd.Timedelta(days=30), now)
    last = None
    global alert
    real_alert = alert
    alert = lambda *_: None                     # warm up on history without alerting
    for t, r in hist.iterrows():
        eng.on_bar(t, r.o, r.h, r.l, r.cl)
        last = t
    alert = real_alert
    alert(f"Signal bot live. ATR {eng.atr:.1f} pts, turn-of-month today: {eng.tom_today}")
    while True:
        time.sleep(61 - dt.datetime.now().second)
        now = pd.Timestamp.now(tz=TZ).floor("min")
        new = src.bars(last + pd.Timedelta(minutes=1), now)
        for t, r in new.iterrows():
            if t > last:
                eng.on_bar(t, r.o, r.h, r.l, r.cl)
                last = t


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "replay":
        replay(sys.argv[2], *sys.argv[3:5])
    elif len(sys.argv) >= 2 and sys.argv[1] == "live":
        live()
    else:
        print(__doc__)
