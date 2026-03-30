import { useState, useEffect, useRef } from 'react'

export type Position = {
  ticket: number
  symbol: string
  type: string
  volume: number
  price_open: number
  sl: number
  tp: number
  profit: number
  comment: string
}

export type AccountPositions = {
  account_id: string
  label: string
  positions: Position[]
}

export type HedgePair = {
  ticket_0: number
  account_0: string
  ticket_1: number
  account_1: string
  symbol: string
  created_at: string
  type_0?: string
  type_1?: string
  sl_pips_0?: number
  tp_pips_0?: number
  sl_pips_1?: number
  tp_pips_1?: number
}

const API = '/api'
const CLOSE_ALL_THRESHOLD_KEY = 'livepositions_close_all_threshold'
const SWAP_AVOID_KEY = 'livepositions_swap_avoid'
const SWAP_LAST_CLOSED_KEY = 'livepositions_swap_last_closed'

function loadCloseAllThreshold(): string {
  try {
    const s = localStorage.getItem(CLOSE_ALL_THRESHOLD_KEY)
    if (s != null && s.trim() !== '') return s.trim()
  } catch (_) {}
  return '0'
}

type SwapAvoidConfig = {
  hourUtc: number
  minuteUtc: number
  minutesBefore: number
  enabled: boolean
}

const DEFAULT_SWAP_AVOID: SwapAvoidConfig = {
  hourUtc: 22,
  minuteUtc: 0,
  minutesBefore: 5,
  enabled: false,
}

function loadSwapAvoidConfig(): SwapAvoidConfig {
  try {
    const s = localStorage.getItem(SWAP_AVOID_KEY)
    if (s) {
      const o = JSON.parse(s)
      return {
        hourUtc: Math.max(0, Math.min(23, Number(o.hourUtc) ?? 22)),
        minuteUtc: Math.max(0, Math.min(59, Number(o.minuteUtc) ?? 0)),
        minutesBefore: Math.max(1, Math.min(60, Number(o.minutesBefore) ?? 5)),
        enabled: !!o.enabled,
      }
    }
  } catch (_) {}
  return DEFAULT_SWAP_AVOID
}

/** Next rollover time in UTC (as Date). */
function getNextRolloverUtc(hourUtc: number, minuteUtc: number): Date {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minuteUtc, 0, 0))
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

/** Date string for rollover (YYYY-MM-DD) for dedupe. */
function rolloverDateKey(next: Date): string {
  return next.toISOString().slice(0, 10)
}

type Props = {
  results?: AccountPositions[]
  lastUpdate?: Date | null
  connected?: boolean
  pairs?: HedgePair[]
  onRefreshPairs?: () => void | Promise<void>
}

function pipSize(symbol: string): number {
  return symbol.includes('JPY') ? 0.01 : 0.0001
}

function normAccount(a: string): string {
  return String(a ?? '').trim().toLowerCase()
}
function normTicket(t: number | string): number {
  return Number(t) || 0
}

function getPanelSlTpPricesForPosition(
  accountId: string,
  ticket: number,
  symbol: string,
  priceOpen: number,
  type: string,
  pairs: HedgePair[]
): { slPrice: number; tpPrice: number } | null {
  const acc = normAccount(accountId)
  const t = normTicket(ticket)
  const pair = pairs.find(
    (q) =>
      (normAccount(q.account_0) === acc && normTicket(q.ticket_0) === t) ||
      (normAccount(q.account_1) === acc && normTicket(q.ticket_1) === t)
  )
  if (!pair) return null
  const pip = pipSize(symbol)
  let slPips: number | null = null
  let tpPips: number | null = null
  if (normAccount(pair.account_0) === acc && normTicket(pair.ticket_0) === t) {
    const v0 = pair.sl_pips_0 != null && pair.sl_pips_0 !== undefined ? Number(pair.sl_pips_0) : null
    const v1 = pair.tp_pips_0 != null && pair.tp_pips_0 !== undefined ? Number(pair.tp_pips_0) : null
    slPips = v0
    tpPips = v1
  } else {
    const v0 = pair.sl_pips_1 != null && pair.sl_pips_1 !== undefined ? Number(pair.sl_pips_1) : null
    const v1 = pair.tp_pips_1 != null && pair.tp_pips_1 !== undefined ? Number(pair.tp_pips_1) : null
    slPips = v0
    tpPips = v1
  }
  if (slPips == null || tpPips == null) return null
  const isBuy = type.toLowerCase() === 'buy'
  const slPrice = isBuy ? priceOpen - slPips * pip : priceOpen + slPips * pip
  const tpPrice = isBuy ? priceOpen + tpPips * pip : priceOpen - tpPips * pip
  return { slPrice, tpPrice }
}

/** Returns pair index, leg (0|1), and current sl/tp pips for a position that belongs to a pair; null otherwise */
function getPanelSlTpEditForPosition(
  accountId: string,
  ticket: number,
  pairs: HedgePair[]
): { pairIndex: number; leg: 0 | 1; slPips: number; tpPips: number } | null {
  const acc = normAccount(accountId)
  const t = normTicket(ticket)
  const pairIndex = pairs.findIndex(
    (q) =>
      (normAccount(q.account_0) === acc && normTicket(q.ticket_0) === t) ||
      (normAccount(q.account_1) === acc && normTicket(q.ticket_1) === t)
  )
  if (pairIndex < 0) return null
  const pair = pairs[pairIndex]
  if (normAccount(pair.account_0) === acc && normTicket(pair.ticket_0) === t) {
    const sl = pair.sl_pips_0 != null && pair.sl_pips_0 !== undefined ? Number(pair.sl_pips_0) : 0
    const tp = pair.tp_pips_0 != null && pair.tp_pips_0 !== undefined ? Number(pair.tp_pips_0) : 0
    return { pairIndex, leg: 0, slPips: sl, tpPips: tp }
  }
  const sl = pair.sl_pips_1 != null && pair.sl_pips_1 !== undefined ? Number(pair.sl_pips_1) : 0
  const tp = pair.tp_pips_1 != null && pair.tp_pips_1 !== undefined ? Number(pair.tp_pips_1) : 0
  return { pairIndex, leg: 1, slPips: sl, tpPips: tp }
}

const EXNESS_ACCOUNT_ID = 'exness'
const BROKER_B_ACCOUNT_ID = 'default' // IC Markets / Broker B

export default function BotLivePositions({ results: resultsProp = [], lastUpdate: lastUpdateProp = null, connected: connectedProp = false, pairs: pairsProp = [], onRefreshPairs }: Props) {
  const [results, setResults] = useState<AccountPositions[]>(resultsProp)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(lastUpdateProp)
  const [connected, setConnected] = useState(connectedProp)
  const [pairs, setPairs] = useState<HedgePair[]>(pairsProp)
  const [exnessCopyCount, setExnessCopyCount] = useState(1)
  const hasClosedForPositiveRef = useRef(false)
  const [editModal, setEditModal] = useState<{ pairIndex: number; leg: 0 | 1; slPips: number; tpPips: number; symbol: string; volume: number } | null>(null)
  const [targetProfitInput, setTargetProfitInput] = useState('')
  const [targetLossInput, setTargetLossInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [closeAllWhenPnlAbove, setCloseAllWhenPnlAbove] = useState(loadCloseAllThreshold)

  const [swapAvoid, setSwapAvoid] = useState<SwapAvoidConfig>(loadSwapAvoidConfig)
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  const lastClosedRolloverRef = useRef<string | null>((() => {
    try {
      return localStorage.getItem(SWAP_LAST_CLOSED_KEY)
    } catch (_) {
      return null
    }
  })())

  useEffect(() => {
    try {
      localStorage.setItem(CLOSE_ALL_THRESHOLD_KEY, closeAllWhenPnlAbove)
    } catch (_) {}
  }, [closeAllWhenPnlAbove])

  useEffect(() => {
    try {
      localStorage.setItem(SWAP_AVOID_KEY, JSON.stringify(swapAvoid))
    } catch (_) {}
  }, [swapAvoid])

  // Countdown to next swap (update every second)
  useEffect(() => {
    const next = getNextRolloverUtc(swapAvoid.hourUtc, swapAvoid.minuteUtc)
    const tick = () => {
      const ms = next.getTime() - Date.now()
      setCountdownMs(ms > 0 ? ms : 0)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [swapAvoid.hourUtc, swapAvoid.minuteUtc])

  // Auto-close all positions X minutes before swap (once per rollover); check every 30s
  useEffect(() => {
    if (!swapAvoid.enabled) return
    const interval = setInterval(() => {
      const total = results.reduce((n, a) => n + a.positions.length, 0)
      if (total === 0) return
      const next = getNextRolloverUtc(swapAvoid.hourUtc, swapAvoid.minuteUtc)
      const closeAt = next.getTime() - swapAvoid.minutesBefore * 60 * 1000
      if (Date.now() < closeAt) return
      const key = rolloverDateKey(next)
      if (lastClosedRolloverRef.current === key) return
      lastClosedRolloverRef.current = key
      try {
        localStorage.setItem(SWAP_LAST_CLOSED_KEY, key)
      } catch (_) {}
      fetch(`${API}/positions/close-all`, { method: 'POST' })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => {
          if (data?.ok) onRefreshPairs?.()
        })
    }, 30_000)
    return () => clearInterval(interval)
  }, [swapAvoid.enabled, swapAvoid.hourUtc, swapAvoid.minuteUtc, swapAvoid.minutesBefore, results, onRefreshPairs])

  useEffect(() => {
    setResults(resultsProp)
    setLastUpdate(lastUpdateProp)
    setConnected(connectedProp)
    setPairs(pairsProp)
  }, [resultsProp, lastUpdateProp, connectedProp, pairsProp])

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/exness-config`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && data?.ok && typeof data.exness_copy_count === 'number') {
          setExnessCopyCount(Math.max(1, Math.floor(data.exness_copy_count)))
        }
      })
    return () => { cancelled = true }
  }, [])

  const totalCount = results.reduce((n, a) => n + a.positions.length, 0)

  // Group all positions by symbol: symbol -> { account, position }[]
  const bySymbol = new Map<string, { account: AccountPositions; position: Position }[]>()
  for (const account of results) {
    for (const position of account.positions) {
      const sym = position.symbol
      if (!bySymbol.has(sym)) bySymbol.set(sym, [])
      bySymbol.get(sym)!.push({ account, position })
    }
  }

  const brokerBAccount = results.find((a) => normAccount(a.account_id) === BROKER_B_ACCOUNT_ID)
  const icMarketsPnl = brokerBAccount
    ? brokerBAccount.positions.reduce((s, p) => s + (p.profit ?? 0), 0)
    : 0

  const exnessAccount = results.find((a) => normAccount(a.account_id) === EXNESS_ACCOUNT_ID)
  const exnessPnl = exnessAccount
    ? exnessAccount.positions.reduce((s, p) => s + (p.profit ?? 0), 0)
    : 0
  const exnessTimesN = exnessPnl * exnessCopyCount
  const combinedPnl = icMarketsPnl + exnessTimesN

  const closeAllThreshold = Number(closeAllWhenPnlAbove)
  const thresholdValid = Number.isFinite(closeAllThreshold)

  function formatCountdown(ms: number | null): string {
    if (ms == null || ms <= 0) return '—'
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // When Overall P/L reaches or exceeds the threshold, close all positions once (reset when P/L goes below threshold or when no positions)
  useEffect(() => {
    const thresh = thresholdValid ? closeAllThreshold : 0
    if (combinedPnl < thresh || totalCount === 0) {
      hasClosedForPositiveRef.current = false
      if (totalCount === 0) return
    }
    if (combinedPnl < thresh) return
    if (totalCount > 0 && !hasClosedForPositiveRef.current) {
      hasClosedForPositiveRef.current = true
      fetch(`${API}/positions/close-all`, { method: 'POST' })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => {
          if (data?.ok) {
            onRefreshPairs?.()
          }
        })
    }
  }, [combinedPnl, totalCount, onRefreshPairs, closeAllThreshold, thresholdValid])

  const symbols = Array.from(bySymbol.keys()).sort()

  const renderSectionForSymbol = (symbol: string) => {
    const rows = bySymbol.get(symbol) ?? []
    const sectionProfit = rows.reduce((s, r) => s + (r.position.profit ?? 0), 0)
    return (
      <section key={symbol} className="live-positions-section">
        <h3 className="live-section-title">{symbol}</h3>
        <p className="live-section-label">
          <span className="live-section-pnl">
            P/L:{' '}
            <span className={sectionProfit >= 0 ? 'profit' : 'loss'}>
              {(sectionProfit >= 0 ? '+' : '') + sectionProfit.toFixed(2)}
            </span>
          </span>
        </p>
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Volume</th>
                <th>Price open</th>
                <th>P/L</th>
                <th>Panel SL</th>
                <th>Panel TP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, position: p }) => {
                const accountId = account.account_id
                const panel = getPanelSlTpPricesForPosition(accountId, p.ticket, p.symbol, p.price_open, p.type, pairs)
                const editInfo = getPanelSlTpEditForPosition(accountId, p.ticket, pairs)
                const decimals = p.symbol.includes('JPY') ? 2 : 5
                const openEdit = () => {
                  if (editInfo) {
                    setEditModal({ ...editInfo, symbol: p.symbol, volume: p.volume })
                    setTargetProfitInput('')
                    setTargetLossInput('')
                  }
                }
                const priceDecimals = p.symbol.includes('JPY') ? 2 : 5
                return (
                  <tr key={`${accountId}-${p.ticket}`}>
                    <td>{account.label}</td>
                    <td>
                      <span className={p.type}>{p.type}</span>
                    </td>
                    <td>{p.volume}</td>
                    <td>{Number(p.price_open).toFixed(priceDecimals)}</td>
                    <td className={p.profit >= 0 ? 'profit' : 'loss'}>
                      {(p.profit >= 0 ? '+' : '') + (p.profit ?? 0).toFixed(2)}
                    </td>
                    <td>
                      {panel != null ? (
                        <button type="button" className="panel-sl-tp-cell" onClick={openEdit} title="Click to change Panel SL/TP">
                          {panel.slPrice.toFixed(decimals)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {panel != null ? (
                        <button type="button" className="panel-sl-tp-cell" onClick={openEdit} title="Click to change Panel SL/TP">
                          {panel.tpPrice.toFixed(decimals)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.5rem' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Live positions</h2>
          <p className="live-status">
            <span className={connected ? 'connected' : 'disconnected'}>
              {connected ? '● Live' : '○ Disconnected'}
            </span>
            {lastUpdate && (
              <span className="last-update">
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </p>
          {totalCount === 0 && !connected && (
            <p className="empty">Connecting to live feed…</p>
          )}
          {totalCount === 0 && connected && results.length === 0 && (
            <p className="empty">No accounts in feed yet.</p>
          )}
        </div>
        <div className="card" style={{ marginLeft: 'auto', padding: '0.75rem 1rem', minWidth: '280px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Swap avoidance</h3>
        <p className="settings-hint" style={{ marginBottom: '0.75rem' }}>
          Broker charges swap at rollover (e.g. IC Markets: 22:00 UTC / 5pm NY). Enable to close all positions a few minutes before rollover to avoid swap fee.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={swapAvoid.enabled}
              onChange={(e) => setSwapAvoid((c) => ({ ...c, enabled: e.target.checked }))}
            />
            Auto-close before swap
          </label>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="swap-rollover-utc">Rollover (UTC)</label>
            <input
              id="swap-rollover-utc"
              type="number"
              min={0}
              max={23}
              value={swapAvoid.hourUtc}
              onChange={(e) => setSwapAvoid((c) => ({ ...c, hourUtc: Math.max(0, Math.min(23, Number(e.target.value) || 0)) }))}
              style={{ width: '3rem', padding: '0.25rem' }}
            />
            :
            <input
              type="number"
              min={0}
              max={59}
              value={swapAvoid.minuteUtc}
              onChange={(e) => setSwapAvoid((c) => ({ ...c, minuteUtc: Math.max(0, Math.min(59, Number(e.target.value) || 0)) }))}
              style={{ width: '3rem', padding: '0.25rem' }}
            />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="swap-close-before">Close</label>
            <input
              id="swap-close-before"
              type="number"
              min={1}
              max={60}
              value={swapAvoid.minutesBefore}
              onChange={(e) => setSwapAvoid((c) => ({ ...c, minutesBefore: Math.max(1, Math.min(60, Number(e.target.value) || 5)) }))}
              style={{ width: '3rem', padding: '0.25rem' }}
            />
            <span>min before</span>
          </span>
        </div>
        <p className="live-totals" style={{ marginBottom: 0 }}>
          <strong>Next swap in:</strong>{' '}
          <span className={countdownMs != null && countdownMs < swapAvoid.minutesBefore * 60 * 1000 ? 'loss' : undefined}>
            {formatCountdown(countdownMs)}
          </span>
          {swapAvoid.enabled && totalCount > 0 && (
            <span className="settings-hint" style={{ marginLeft: '0.5rem' }}>
              (positions will close {swapAvoid.minutesBefore} min before rollover)
            </span>
          )}
        </p>
        </div>
      </div>

      {results.length > 0 && (
        <>
          <div className="live-totals-row">
            <p className="live-totals" title="Broker B (IC Markets) account">
              IC Markets P/L:{' '}
              <span className={icMarketsPnl >= 0 ? 'profit' : 'loss'}>
                {(icMarketsPnl >= 0 ? '+' : '') + icMarketsPnl.toFixed(2)}
              </span>
            </p>
            <p className="live-totals exness-times-n" title={`Exness single-account P/L × N (N = ${exnessCopyCount} from Exness copy hedge). Estimated combined P/L of all N copy accounts.`}>
              Exness × {exnessCopyCount} P/L:{' '}
              <span className={exnessTimesN >= 0 ? 'profit' : 'loss'}>
                {(exnessTimesN >= 0 ? '+' : '') + exnessTimesN.toFixed(2)}
              </span>
            </p>
            <p className="live-totals live-totals-combined" title="IC Markets P/L + Exness × N P/L (overall P/L across both sides)">
              Overall P/L:{' '}
              <span className={combinedPnl >= 0 ? 'profit' : 'loss'}>
                {(combinedPnl >= 0 ? '+' : '') + combinedPnl.toFixed(2)}
              </span>
            </p>
            <p className="live-totals" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <label htmlFor="close-all-threshold">Close all when P/L ≥ ($)</label>
              <input
                id="close-all-threshold"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={closeAllWhenPnlAbove}
                onChange={(e) => setCloseAllWhenPnlAbove(e.target.value)}
                style={{ width: '6rem', padding: '0.25rem 0.5rem' }}
                title="When Overall P/L reaches this amount (or more), all positions are closed once. Use 0 for any profit; reset when P/L drops below this."
              />
            </p>
          </div>
          <div className="live-positions-sections">
            {symbols.map((symbol) => renderSectionForSymbol(symbol))}
          </div>
        </>
      )}

      {editModal != null && (
        <div className="modal-overlay" onClick={() => !saving && setEditModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Panel SL/TP — {editModal.symbol}</h3>
            <p className="settings-hint">Pips for this leg. When price hits, both positions close.</p>

            <div className="modal-target-profit">
              <label>Target profit ($)</label>
              <p className="settings-hint" style={{ margin: '0.2rem 0 0.4rem 0' }}>
                Enter desired profit in USD — TP (pips) updates automatically for volume {editModal.volume}.
              </p>
              <input
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 20"
                value={targetProfitInput}
                onChange={(e) => {
                  const val = e.target.value
                  setTargetProfitInput(val)
                  const profit = Number(val)
                  if (Number.isFinite(profit) && profit > 0 && editModal.volume > 0) {
                    const pipValuePerLot = editModal.symbol.includes('JPY') ? 9 : 10
                    const tpPips = Math.round(profit / (pipValuePerLot * editModal.volume))
                    setEditModal((m) => m ? { ...m, tpPips: Math.max(1, tpPips) } : null)
                  }
                }}
                style={{ width: '6rem', marginBottom: '0.75rem' }}
              />
              <label>Target loss ($)</label>
              <p className="settings-hint" style={{ margin: '0.2rem 0 0.4rem 0' }}>
                Enter max loss in USD — SL (pips) updates automatically for volume {editModal.volume}.
              </p>
              <input
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 10"
                value={targetLossInput}
                onChange={(e) => {
                  const val = e.target.value
                  setTargetLossInput(val)
                  const loss = Number(val)
                  if (Number.isFinite(loss) && loss > 0 && editModal.volume > 0) {
                    const pipValuePerLot = editModal.symbol.includes('JPY') ? 9 : 10
                    const slPips = Math.round(loss / (pipValuePerLot * editModal.volume))
                    setEditModal((m) => m ? { ...m, slPips: Math.max(1, slPips) } : null)
                  }
                }}
                style={{ width: '6rem' }}
              />
            </div>

            <div className="row" style={{ gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label>Panel SL (pips)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editModal.slPips}
                  onChange={(e) => setEditModal((m) => m && { ...m, slPips: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div>
                <label>Panel TP (pips)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editModal.tpPips}
                  onChange={(e) => setEditModal((m) => m && { ...m, tpPips: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: '1rem', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  if (!editModal) return
                  setSaving(true)
                  try {
                    const r = await fetch(`${API}/hedge-pair-update`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        index: editModal.pairIndex,
                        leg: editModal.leg,
                        sl_pips: editModal.slPips,
                        tp_pips: editModal.tpPips,
                      }),
                    })
                    const data = await r.json().catch(() => ({}))
                    if (data.ok) {
                      await Promise.resolve(onRefreshPairs?.())
                      setEditModal(null)
                    }
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" disabled={saving} onClick={() => setEditModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
