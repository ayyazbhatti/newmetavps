import { useMemo, useState } from 'react'

export type Deal = {
  ticket: number
  time: number
  symbol: string
  type: string
  volume: number
  price: number
  profit: number
  swap?: number
  commission?: number
  /** MT5 DEAL_ENTRY: 0=in, 1=out, 2=reverse, 3=out by reverse */
  entry?: number
  position_id?: number
  comment: string
}

type AccountDeals = {
  account_id: string
  label: string
  deals: Deal[]
}

type Props = {
  allHistory: AccountDeals[]
  historyLoading?: boolean
  onRefresh: () => void
}

function formatTime(ts: number) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleString()
}

type AccountStats = {
  label: string
  accountId: string
  trades: number
  totalProfit: number
  totalSwap: number
  totalCommission: number
  wins: number
  losses: number
  winRatePct: number
  totalVolume: number
}

function computeStats(accountId: string, label: string, deals: Deal[]): AccountStats {
  const trades = deals.length
  const totalProfit = deals.reduce((s, d) => s + d.profit, 0)
  const totalSwap = deals.reduce((s, d) => s + (d.swap ?? 0), 0)
  const totalCommission = deals.reduce((s, d) => s + (d.commission ?? 0), 0)
  const wins = deals.filter((d) => d.profit > 0).length
  const losses = deals.filter((d) => d.profit < 0).length
  const winRatePct = trades > 0 ? (wins / trades) * 100 : 0
  const totalVolume = deals.reduce((s, d) => s + d.volume, 0)
  return { label, accountId, trades, totalProfit, totalSwap, totalCommission, wins, losses, winRatePct, totalVolume }
}

function formatProfit(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(2)
}

/** Deal with account info for swap summary */
type DealWithAccount = { deal: Deal; accountLabel: string; accountId: string }

function isClosedDeal(d: Deal): boolean {
  // MT5 DEAL_ENTRY: 1=out, 3=out by reverse
  return d.entry === 1 || d.entry === 3
}

function SwapSummaryCard({ dealsWithAccount }: { dealsWithAccount: DealWithAccount[] }) {
  const dealsWithSwap = dealsWithAccount.filter(({ deal: d }) => d.swap != null && d.swap !== 0)
  // Newest first
  dealsWithSwap.sort((a, b) => b.deal.time - a.deal.time)

  const totalSwap = dealsWithSwap.reduce((s, { deal }) => s + (deal.swap ?? 0), 0)

  // Group by hour (UTC) to show when swap tends to be applied (rollover time)
  const byHourUtc: Record<number, { count: number; sum: number }> = {}
  for (const { deal } of dealsWithSwap) {
    const date = new Date(deal.time * 1000)
    const hour = date.getUTCHours()
    if (!byHourUtc[hour]) byHourUtc[hour] = { count: 0, sum: 0 }
    byHourUtc[hour].count += 1
    byHourUtc[hour].sum += deal.swap ?? 0
  }
  const hoursSorted = Object.entries(byHourUtc).sort((a, b) => Number(b[0]) - Number(a[0]))

  if (dealsWithSwap.length === 0) {
    return (
      <div className="card">
        <h2>Swap summary</h2>
        <p className="empty">No Exness closed deals with swap in selected filters. Swap appears when positions are held overnight and then closed.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Exness swap summary</h2>
      <p className="settings-hint" style={{ marginBottom: '0.75rem' }}>
        Exness deals with non-zero swap. Total swap in period: <strong className={totalSwap >= 0 ? 'profit' : 'loss'}>{formatProfit(totalSwap)}</strong>.
      </p>
      {hoursSorted.length > 0 && (
        <div className="history-swap-hours">
          <span className="settings-hint">Swap by hour (UTC): </span>
          {hoursSorted.map(([hour, { count, sum }]) => (
            <span key={hour} className="history-swap-hour-chip">
              {hour.toString().padStart(2, '0')}:00 — {count} deal(s), {formatProfit(sum)}
            </span>
          ))}
        </div>
      )}
      <div className="dashboard-table-wrap">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Time (deal)</th>
              <th>Symbol</th>
              <th>Entry</th>
              <th>Swap</th>
            </tr>
          </thead>
          <tbody>
            {dealsWithSwap.map(({ deal: d, accountLabel }) => (
              <tr key={`${d.ticket}-${accountLabel}`}>
                <td>{accountLabel}</td>
                <td>{formatTime(d.time)}</td>
                <td>{d.symbol}</td>
                <td>{d.entry === 0 ? 'in' : d.entry === 1 ? 'out' : d.entry === 2 ? 'reverse' : d.entry === 3 ? 'out rev' : d.entry != null ? String(d.entry) : '—'}</td>
                <td className={(d.swap ?? 0) >= 0 ? 'profit' : 'loss'}>{formatProfit(d.swap ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function BotHistory({ allHistory, historyLoading = false, onRefresh }: Props) {
  const exnessOnlyHistory = useMemo(
    () => allHistory.filter((a) => a.account_id === 'exness' || a.label.toLowerCase().includes('exness')),
    [allHistory]
  )
  const closedRows = useMemo(() => {
    const rows = exnessOnlyHistory.flatMap(({ account_id, label, deals }) =>
      deals
        .filter(isClosedDeal)
        .map((d) => ({ accountId: account_id, accountLabel: label, deal: d }))
    )
    rows.sort((a, b) => b.deal.time - a.deal.time)
    return rows
  }, [exnessOnlyHistory])

  const symbols = useMemo(
    () => Array.from(new Set(closedRows.map((r) => r.deal.symbol))).sort(),
    [closedRows]
  )
  const [symbolFilter, setSymbolFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')

  const filteredRows = useMemo(() => {
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() / 1000 : null
    const toTs = dateTo ? (new Date(`${dateTo}T23:59:59`).getTime() / 1000) : null
    return closedRows.filter(({ deal }) => {
      if (symbolFilter !== 'all' && deal.symbol !== symbolFilter) return false
      if (fromTs != null && deal.time < fromTs) return false
      if (toTs != null && deal.time > toTs) return false
      return true
    })
  }, [closedRows, symbolFilter, dateFrom, dateTo])

  const totalCount = filteredRows.length
  const filteredDeals = filteredRows.map((r) => r.deal)
  const statsExness: AccountStats | null =
    filteredDeals.length > 0 ? computeStats('exness', 'Exness', filteredDeals) : null

  return (
    <>
      {!historyLoading && statsExness && (
        <div className="card">
          <h2>Exness stats (last 30 days)</h2>
          <div className="closed-pairs-stats history-stats-grid">
            <div className="history-stat-box">
              <div className="settings-hint history-stat-label">{statsExness.label}</div>
              <div className={`${statsExness.totalProfit >= 0 ? 'profit' : 'loss'} history-stat-profit`}>
                {formatProfit(statsExness.totalProfit)}
              </div>
              <div className="history-stat-sub">
                {statsExness.trades} trades · {statsExness.wins}W / {statsExness.losses}L · {statsExness.winRatePct.toFixed(0)}% win
              </div>
              <div className="history-stat-sub">Vol: {statsExness.totalVolume.toFixed(2)}</div>
              {(statsExness.totalSwap !== 0 || statsExness.totalCommission !== 0) && (
                <div className="history-stat-sub">Swap: {formatProfit(statsExness.totalSwap)} · Comm: {formatProfit(statsExness.totalCommission)}</div>
              )}
            </div>
          </div>
        </div>
      )}
      {!historyLoading && <SwapSummaryCard dealsWithAccount={filteredRows} />}
      <div className="card">
        <h2>Exness positions history (closed deals, last 30 days)</h2>
        <p className="settings-hint" style={{ marginBottom: '0.5rem' }}>
          Showing closed deals only (entry = out / out by reverse). Use filters below; stats and swap summary update automatically.
        </p>
        <div className="form-row-inline history-filters">
          <div className="form-row">
            <label htmlFor="history-date-from">Date from</label>
            <input
              id="history-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="history-date-to">Date to</label>
            <input
              id="history-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="history-symbol">Symbol</label>
            <select
              id="history-symbol"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
            >
              <option value="all">All symbols</option>
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" onClick={onRefresh} disabled={historyLoading} className="history-refresh-btn">
          Refresh
        </button>
        {historyLoading ? (
          <p className="loading">Loading history…</p>
        ) : totalCount === 0 ? (
          <p className="empty">No closed deals in history for Exness account.</p>
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Time</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Entry</th>
                  <th>Volume</th>
                  <th>Price</th>
                  <th>Profit</th>
                  <th>Swap</th>
                  <th>Commission</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ accountId, accountLabel, deal: d }) => (
                  <tr key={`${accountId}-${d.ticket}-${d.time}`}>
                    <td>{accountLabel}</td>
                    <td>{formatTime(d.time)}</td>
                    <td>{d.symbol}</td>
                    <td><span className={d.type}>{d.type}</span></td>
                    <td>{d.entry === 0 ? 'in' : d.entry === 1 ? 'out' : d.entry === 2 ? 'reverse' : d.entry === 3 ? 'out rev' : d.entry != null ? String(d.entry) : '—'}</td>
                    <td>{d.volume}</td>
                    <td>{d.price.toFixed(5)}</td>
                    <td className={d.profit >= 0 ? 'profit' : 'loss'}>
                      {(d.profit >= 0 ? '+' : '') + d.profit.toFixed(2)}
                    </td>
                    <td className={(d.swap ?? 0) >= 0 ? 'profit' : 'loss'}>
                      {(d.swap ?? 0) !== 0 ? ((d.swap ?? 0) >= 0 ? '+' : '') + (d.swap ?? 0).toFixed(2) : '—'}
                    </td>
                    <td className={(d.commission ?? 0) >= 0 ? 'profit' : 'loss'}>
                      {(d.commission ?? 0) !== 0 ? ((d.commission ?? 0) >= 0 ? '+' : '') + (d.commission ?? 0).toFixed(2) : '—'}
                    </td>
                    <td>{d.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
