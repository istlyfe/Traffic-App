// Prop-firm rule engine. Pure functions + a small per-account persisted state (high-water mark, daily P&L history).

// Futures trading day rolls at 5pm Chicago time.
export function tradeDate(now) {
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  if (ct.getHours() >= 17) ct.setDate(ct.getDate() + 1);
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
}

export function evaluate(acct, r, st, today) {
  const netLiq = acct.cashBalance + acct.openPnL;

  // Day rollover: close out yesterday into history, start a new day.
  if (st.day !== today) {
    if (st.day && st.lastCash != null) {
      st.days = { ...(st.days || {}), [st.day]: st.lastCash - st.dayStart };
      if (r.drawdownMode === 'eod') st.hwm = Math.max(st.hwm ?? r.startingBalance, st.lastCash);
    }
    st.day = today;
    st.dayStart = acct.cashBalance;
  }
  st.lastCash = acct.cashBalance;
  st.hwm ??= Math.max(r.startingBalance, acct.cashBalance);
  if (r.drawdownMode !== 'eod') st.hwm = Math.max(st.hwm, netLiq); // intraday trails unrealized peaks too

  let floor = st.hwm - r.trailingDrawdown;
  if (r.drawdownLocksAt != null) floor = Math.min(floor, r.drawdownLocksAt);
  const ddBuffer = netLiq - floor;
  const ddUsedPct = clampPct(100 * (1 - ddBuffer / r.trailingDrawdown));

  const dayPnL = netLiq - st.dayStart;
  const totalProfit = netLiq - r.startingBalance;
  const history = { ...(st.days || {}), [today]: acct.cashBalance - st.dayStart };
  const tradingDays = Object.values(history).filter((v) => Math.abs(v) > 0.01).length;
  const bestDay = Math.max(0, ...Object.values(history));

  const checks = [];
  const add = (key, label, level, detail) => checks.push({ key, label, level, detail });
  const warn = r.warnAtPct ?? 70;

  add('drawdown', 'Trailing drawdown', ddBuffer <= 0 ? 'breach' : ddUsedPct >= warn ? 'warn' : 'ok',
    `${usd(ddBuffer)} left · floor ${usd(floor)}${r.drawdownLocksAt != null && floor === r.drawdownLocksAt ? ' (locked)' : ''}`);

  if (r.dailyLossLimit) {
    const used = clampPct(100 * (-dayPnL / r.dailyLossLimit));
    add('daily', 'Daily loss limit', -dayPnL >= r.dailyLossLimit ? 'breach' : used >= warn ? 'warn' : 'ok',
      `${usd(r.dailyLossLimit + dayPnL)} left today`);
  }
  if (r.maxContracts) {
    add('contracts', 'Max contracts', acct.openContracts > r.maxContracts ? 'breach' : acct.openContracts === r.maxContracts ? 'warn' : 'ok',
      `${acct.openContracts} / ${r.maxContracts} open`);
  }
  if (r.consistencyPct && totalProfit > 0) {
    const pct = (100 * bestDay) / totalProfit;
    add('consistency', 'Consistency', pct > r.consistencyPct ? 'warn' : 'ok',
      `best day ${pct.toFixed(0)}% of profit (max ${r.consistencyPct}%)`);
  }
  if (r.type === 'eval' && r.profitTarget) {
    const hit = totalProfit >= r.profitTarget;
    const daysOk = !r.minTradingDays || tradingDays >= r.minTradingDays;
    add('target', 'Profit target', hit && daysOk ? 'pass' : 'ok',
      `${usd(totalProfit)} / ${usd(r.profitTarget)}${r.minTradingDays ? ` · ${tradingDays}/${r.minTradingDays} days` : ''}`);
  }

  const order = ['breach', 'warn', 'pass', 'ok'];
  const status = order.find((lvl) => checks.some((c) => c.level === lvl)) || 'ok';

  return {
    netLiq, dayPnL, totalProfit, floor, ddBuffer, ddUsedPct, tradingDays, status, checks,
    targetPct: r.type === 'eval' && r.profitTarget ? clampPct((100 * totalProfit) / r.profitTarget) : null,
  };
}

const clampPct = (n) => Math.max(0, Math.min(100, n));
const usd = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
