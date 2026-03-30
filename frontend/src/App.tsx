import { useState, useEffect, useCallback, useRef } from 'react'
import BotPositions from './pages/BotPositions'
import BotHistory from './pages/BotHistory'
import BotTrading from './pages/BotTrading'
import BotSettings from './pages/BotSettings'
import BotLivePositions from './pages/BotLivePositions'
import FixedLot from './pages/FixedLot'
import ExnessClones from './pages/ExnessClones'
import { getPanelWsBase } from './panelWsBase'

const API = '/api'
const WORKER_STORAGE_KEY = 'mt5bot_worker'
const WORKER_BALANCE_KEY = 'mt5bot_worker_balance'
const SL_TP_PIPS_STORAGE_KEY = 'mt5bot_sl_tp_pips'
const SL_TP_ENABLED_KEY = 'mt5bot_sl_tp_enabled'

/** Worker config from backend (snake_case). */
type WorkerConfigApi = {
  enabled?: boolean
  fixed_interval?: boolean
  interval_minutes?: number
  min_minutes?: number
  max_minutes?: number
  symbols?: string[]
  min_volume?: number
  max_volume?: number
  place_mode?: string
  next_run_at?: string | null
  last_run_at?: string | null
  run_count?: number
  failed_positions?: { time: string; symbol: string; volume: number; message?: string }[]
  worker_balance?: { account1_buy?: number; account1_sell?: number }
  use_sl_tp?: boolean
  sl_tp_pips?: Record<string, { sl_pips: number; tp_pips: number }>
  max_open_positions?: number
}

function loadSlTpEnabled(): boolean {
  try {
    const s = localStorage.getItem(SL_TP_ENABLED_KEY)
    if (s != null) return JSON.parse(s) !== false
  } catch (_) {}
  return true
}

function setWorkerBalance(account1Buy: number, account1Sell: number) {
  try {
    localStorage.setItem(WORKER_BALANCE_KEY, JSON.stringify({ account1Buy, account1Sell }))
  } catch (_) {}
}

export type FailedPositionRecord = { time: string; symbol: string; volume: number; message?: string }

export type SlTpPips = { sl_pips: number; tp_pips: number }

function defaultSlTpPips(): Record<string, SlTpPips> {
  return { default: { sl_pips: 10, tp_pips: 30 }, exness: { sl_pips: 30, tp_pips: 10 } }
}

function loadSlTpPips(): Record<string, SlTpPips> {
  try {
    const s = localStorage.getItem(SL_TP_PIPS_STORAGE_KEY)
    if (s) {
      const o = JSON.parse(s) as Record<string, { sl_pips?: number; tp_pips?: number }>
      const out: Record<string, SlTpPips> = {}
      for (const [id, v] of Object.entries(o)) {
        const sl = Number(v?.sl_pips)
        const tp = Number(v?.tp_pips)
        if (Number.isFinite(sl) && Number.isFinite(tp) && sl >= 0 && tp >= 0) {
          out[id] = { sl_pips: sl, tp_pips: tp }
        }
      }
      if (Object.keys(out).length > 0) return { ...defaultSlTpPips(), ...out }
    }
  } catch (_) {}
  return defaultSlTpPips()
}

type Page = 'positions' | 'history' | 'livepositions' | 'trading' | 'settings' | 'fixedlot' | 'exnessclones'

export type WorkerPlaceMode = 'both' | 'master_slave_hedge'

function loadWorkerSettings(): {
  enabled: boolean
  fixedInterval: boolean
  intervalMinutes: number
  minMinutes: number
  maxMinutes: number
  symbols: string[]
  minVolume: number
  maxVolume: number
  placeMode: WorkerPlaceMode
  maxOpenPositions: number
} {
  try {
    const s = localStorage.getItem(WORKER_STORAGE_KEY)
    if (s) {
      const o = JSON.parse(s)
      const symbols = Array.isArray(o.symbols) ? o.symbols : (typeof o.symbol === 'string' && o.symbol ? [o.symbol] : [])
      const legacyVol = Math.max(0.0001, Number(o.volume) || 0.01)
      const minV = Number(o.minVolume)
      const maxV = Number(o.maxVolume)
      const minVolume = Number.isFinite(minV) && minV >= 0.0001 ? minV : legacyVol
      const maxVolume = Number.isFinite(maxV) && maxV >= 0.0001 ? maxV : legacyVol
      const minMin = Math.max(0.5, Math.min(1440, Number(o.minMinutes) || 1))
      const maxMin = Math.max(1, Math.min(1440, Number(o.maxMinutes) || 5))
      const fixedInterval = !!o.fixedInterval
      const intervalMinutes = Math.max(0.5, Math.min(1440, Number(o.intervalMinutes) || 15))
      const placeMode = (o.placeMode === 'master_slave_hedge' ? 'master_slave_hedge' : 'both') as WorkerPlaceMode
      const maxOpen = Math.max(0, Math.floor(Number(o.maxOpenPositions ?? o.max_open_positions) || 0))
      return {
        enabled: !!o.enabled,
        fixedInterval,
        intervalMinutes,
        minMinutes: minMin,
        maxMinutes: Math.max(minMin, maxMin),
        symbols: symbols.filter((x: unknown) => typeof x === 'string'),
        minVolume,
        maxVolume: Math.max(minVolume, maxVolume),
        placeMode,
        maxOpenPositions: maxOpen,
      }
    }
  } catch (_) {}
  return { enabled: false, fixedInterval: false, intervalMinutes: 15, minMinutes: 1, maxMinutes: 5, symbols: [], minVolume: 0.0001, maxVolume: 0.01, placeMode: 'both', maxOpenPositions: 0 }
}

async function fetchWorkerConfig(): Promise<WorkerConfigApi | null> {
  try {
    const r = await fetch(`${API}/worker/config`)
    if (!r.ok) return null
    const data = await r.json()
    return data as WorkerConfigApi
  } catch {
    return null
  }
}

async function patchWorkerConfig(patch: Record<string, unknown>): Promise<WorkerConfigApi | null> {
  try {
    const r = await fetch(`${API}/worker/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) return null
    const data = await r.json()
    return data as WorkerConfigApi
  } catch {
    return null
  }
}

async function workerRunOnce(): Promise<WorkerConfigApi | null> {
  try {
    const r = await fetch(`${API}/worker/run-once`, { method: 'POST' })
    if (!r.ok) return null
    const data = await r.json()
    return data as WorkerConfigApi
  } catch {
    return null
  }
}

const HASH_TO_PAGE: Record<string, Page> = {
  dashboard: 'positions',
  positions: 'positions',
  history: 'history',
  livepositions: 'livepositions',
  trading: 'trading',
  settings: 'settings',
  fixedlot: 'fixedlot',
  exnessclones: 'exnessclones',
}

function getPageFromHash(): Page {
  const hash = window.location.hash.slice(1).toLowerCase() || 'positions'
  return HASH_TO_PAGE[hash] ?? 'positions'
}

type Account = { id: string; label: string }

type Position = {
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

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>(getPageFromHash)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    const onHashChange = () => setCurrentPage(getPageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    setNavOpen(false)
  }, [currentPage])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const closeOnWide = () => {
      if (mq.matches) setNavOpen(false)
    }
    mq.addEventListener('change', closeOnWide)
    return () => mq.removeEventListener('change', closeOnWide)
  }, [])

  useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [navOpen])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<string>('default')
  const [symbols, setSymbols] = useState<string[]>([])
  const [, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [symbol, setSymbol] = useState('')
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy')
  const [volume, setVolume] = useState(0.01)
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [comment, setComment] = useState('')
  const [placeOnBoth, setPlaceOnBoth] = useState(false)
  const [placeMasterSlaveHedge, setPlaceMasterSlaveHedge] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [slTpPipsByAccount, setSlTpPipsByAccount] = useState<Record<string, SlTpPips>>(loadSlTpPips)
  const [useSlTp, setUseSlTp] = useState(loadSlTpEnabled)

  const [workerEnabled, setWorkerEnabled] = useState(() => loadWorkerSettings().enabled)
  const [workerFixedInterval, setWorkerFixedInterval] = useState(() => loadWorkerSettings().fixedInterval)
  const [workerIntervalMinutes, setWorkerIntervalMinutes] = useState(() => loadWorkerSettings().intervalMinutes)
  const [workerMinMinutes, setWorkerMinMinutes] = useState(() => loadWorkerSettings().minMinutes)
  const [workerMaxMinutes, setWorkerMaxMinutes] = useState(() => loadWorkerSettings().maxMinutes)
  const [workerSymbols, setWorkerSymbols] = useState<string[]>(() => loadWorkerSettings().symbols)
  const [workerMinVolume, setWorkerMinVolume] = useState(() => loadWorkerSettings().minVolume)
  const [workerMaxVolume, setWorkerMaxVolume] = useState(() => loadWorkerSettings().maxVolume)
  const [workerPlaceMode, setWorkerPlaceMode] = useState<WorkerPlaceMode>(() => loadWorkerSettings().placeMode)
  const [workerMaxOpenPositions, setWorkerMaxOpenPositions] = useState<number>(() => loadWorkerSettings().maxOpenPositions)
  const [workerLastRun, setWorkerLastRun] = useState<Date | null>(null)
  const [workerNextRunAt, setWorkerNextRunAt] = useState<Date | null>(null)
  const [workerRunCount, setWorkerRunCountState] = useState(0)
  const [workerFailedPositions, setWorkerFailedPositionsState] = useState<FailedPositionRecord[]>([])
  const workerSkipNextPatchRef = useRef(true)

  const applyWorkerConfigToState = useCallback((data: WorkerConfigApi | null) => {
    if (!data) return
    if (typeof data.enabled === 'boolean') setWorkerEnabled(data.enabled)
    if (typeof data.fixed_interval === 'boolean') setWorkerFixedInterval(data.fixed_interval)
    if (typeof data.interval_minutes === 'number') setWorkerIntervalMinutes(data.interval_minutes)
    if (typeof data.min_minutes === 'number') setWorkerMinMinutes(data.min_minutes)
    if (typeof data.max_minutes === 'number') setWorkerMaxMinutes(data.max_minutes)
    if (Array.isArray(data.symbols)) setWorkerSymbols(data.symbols)
    if (typeof data.min_volume === 'number') setWorkerMinVolume(data.min_volume)
    if (typeof data.max_volume === 'number') setWorkerMaxVolume(data.max_volume)
    if (typeof data.place_mode === 'string') setWorkerPlaceMode((data.place_mode === 'master_slave_hedge' ? 'master_slave_hedge' : 'both') as WorkerPlaceMode)
    if (typeof data.use_sl_tp === 'boolean') setUseSlTp(data.use_sl_tp)
    if (data.sl_tp_pips && typeof data.sl_tp_pips === 'object') setSlTpPipsByAccount(data.sl_tp_pips)
    if (typeof data.max_open_positions === 'number' && data.max_open_positions >= 0) setWorkerMaxOpenPositions(data.max_open_positions)
    const nextRunAt = data.next_run_at && String(data.next_run_at).trim() ? new Date(data.next_run_at) : null
    setWorkerNextRunAt(nextRunAt && !Number.isNaN(nextRunAt.getTime()) ? nextRunAt : null)
    const lastRunAt = data.last_run_at && String(data.last_run_at).trim() ? new Date(data.last_run_at) : null
    setWorkerLastRun(lastRunAt && !Number.isNaN(lastRunAt.getTime()) ? lastRunAt : null)
    const runCount = typeof data.run_count === 'number' ? data.run_count : (typeof data.run_count === 'string' ? parseInt(data.run_count, 10) : NaN)
    if (!Number.isNaN(runCount) && runCount >= 0) setWorkerRunCountState(runCount)
    if (Array.isArray(data.failed_positions)) {
      setWorkerFailedPositionsState(data.failed_positions.map((fp) => ({
        time: fp.time,
        symbol: fp.symbol,
        volume: fp.volume,
        message: fp.message,
      })))
    }
    if (data.worker_balance) {
      setWorkerBalance(
        Number(data.worker_balance.account1_buy) || 0,
        Number(data.worker_balance.account1_sell) || 0
      )
    }
  }, [])

  /** Update only server-driven fields (countdown, run count, etc.) so the poll never triggers PATCH. */
  const applyWorkerConfigServerOnly = useCallback((data: WorkerConfigApi | null) => {
    if (!data) return
    const nextRunAt = data.next_run_at && String(data.next_run_at).trim() ? new Date(data.next_run_at) : null
    setWorkerNextRunAt(nextRunAt && !Number.isNaN(nextRunAt.getTime()) ? nextRunAt : null)
    const lastRunAt = data.last_run_at && String(data.last_run_at).trim() ? new Date(data.last_run_at) : null
    setWorkerLastRun(lastRunAt && !Number.isNaN(lastRunAt.getTime()) ? lastRunAt : null)
    const runCount = typeof data.run_count === 'number' ? data.run_count : (typeof data.run_count === 'string' ? parseInt(data.run_count, 10) : NaN)
    if (!Number.isNaN(runCount) && runCount >= 0) setWorkerRunCountState(runCount)
    if (Array.isArray(data.failed_positions)) {
      setWorkerFailedPositionsState(data.failed_positions.map((fp) => ({
        time: fp.time,
        symbol: fp.symbol,
        volume: fp.volume,
        message: fp.message,
      })))
    }
    if (data.worker_balance) {
      setWorkerBalance(
        Number(data.worker_balance.account1_buy) || 0,
        Number(data.worker_balance.account1_sell) || 0
      )
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchWorkerConfig().then((data) => {
      if (!cancelled && data) {
        workerSkipNextPatchRef.current = true
        applyWorkerConfigToState(data)
      }
    })
    return () => { cancelled = true }
  }, [applyWorkerConfigToState])

  // Refetch worker config when user opens Settings so counter and next-run are fresh
  useEffect(() => {
    if (currentPage !== 'settings') return
    let cancelled = false
    fetchWorkerConfig().then((data) => {
      if (!cancelled && data) {
        workerSkipNextPatchRef.current = true
        applyWorkerConfigToState(data)
      }
    })
    return () => { cancelled = true }
  }, [currentPage, applyWorkerConfigToState])

  useEffect(() => {
    try {
      localStorage.setItem(SL_TP_ENABLED_KEY, JSON.stringify(useSlTp))
    } catch (_) {}
  }, [useSlTp])

  useEffect(() => {
    if (workerSkipNextPatchRef.current) {
      workerSkipNextPatchRef.current = false
      return
    }
    patchWorkerConfig({
      enabled: workerEnabled,
      fixedInterval: workerFixedInterval,
      intervalMinutes: workerIntervalMinutes,
      minMinutes: workerMinMinutes,
      maxMinutes: workerMaxMinutes,
      symbols: workerSymbols,
      minVolume: workerMinVolume,
      maxVolume: workerMaxVolume,
      placeMode: workerPlaceMode,
      useSlTp: useSlTp,
      slTpPips: slTpPipsByAccount,
      maxOpenPositions: workerMaxOpenPositions,
    }).then((data) => {
      if (data) {
        workerSkipNextPatchRef.current = true
        applyWorkerConfigToState(data)
      }
    })
  }, [workerEnabled, workerFixedInterval, workerIntervalMinutes, workerMinMinutes, workerMaxMinutes, workerSymbols, workerMinVolume, workerMaxVolume, workerPlaceMode, useSlTp, slTpPipsByAccount, workerMaxOpenPositions, applyWorkerConfigToState])

  // Persist worker settings to localStorage so they survive refresh (backend is source of truth but we show this until fetch applies)
  useEffect(() => {
    try {
      localStorage.setItem(WORKER_STORAGE_KEY, JSON.stringify({
        enabled: workerEnabled,
        fixedInterval: workerFixedInterval,
        intervalMinutes: workerIntervalMinutes,
        minMinutes: workerMinMinutes,
        maxMinutes: workerMaxMinutes,
        symbols: workerSymbols,
        minVolume: workerMinVolume,
        maxVolume: workerMaxVolume,
        placeMode: workerPlaceMode,
        maxOpenPositions: workerMaxOpenPositions,
      }))
    } catch (_) {}
  }, [workerEnabled, workerFixedInterval, workerIntervalMinutes, workerMinMinutes, workerMaxMinutes, workerSymbols, workerMinVolume, workerMaxVolume, workerPlaceMode, workerMaxOpenPositions])

  useEffect(() => {
    if (!workerEnabled) return
    const ms = currentPage === 'settings' ? 10000 : 45000
    const t = setInterval(() => {
      fetchWorkerConfig().then((data) => data && applyWorkerConfigServerOnly(data))
    }, ms)
    return () => clearInterval(t)
  }, [workerEnabled, currentPage, applyWorkerConfigServerOnly])

  useEffect(() => {
    try {
      localStorage.setItem(SL_TP_PIPS_STORAGE_KEY, JSON.stringify(slTpPipsByAccount))
    } catch (_) {}
  }, [slTpPipsByAccount])

  // Keep worker symbols in sync with current account: remove any that are not in the loaded symbol list
  useEffect(() => {
    if (symbols.length === 0) return
    setWorkerSymbols((prev) => prev.filter((s) => symbols.includes(s)))
  }, [symbols])

  const fetchAccounts = useCallback(async () => {
    try {
      const r = await fetch(`${API}/accounts`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.accounts)) {
        setAccounts(data.accounts)
        if (data.accounts.length > 0 && !data.accounts.some((a: Account) => a.id === accountId)) {
          setAccountId(data.accounts[0].id)
        }
      }
    } catch (_) {}
  }, [accountId])

  const fetchSymbols = useCallback(async () => {
    setConnectionError(null)
    try {
      const r = await fetch(`${API}/symbols?account_id=${encodeURIComponent(accountId)}`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.symbols)) {
        setSymbols(data.symbols)
      } else {
        const errMsg = data.error ?? data.message ?? (r.ok ? 'Could not load symbols.' : `Server error ${r.status}`)
        setConnectionError(errMsg)
      }
    } catch (e) {
      setConnectionError('Cannot reach API. Start the backend from project root: cargo run --manifest-path backend/Cargo.toml')
    }
  }, [accountId])

  const fetchPositions = useCallback(async () => {
    try {
      const r = await fetch(`${API}/positions?account_id=${encodeURIComponent(accountId)}`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.positions)) {
        setPositions(data.positions)
      } else if (!r.ok) {
        const err = data.error ?? data.message ?? `Error ${r.status}`
        setMsg({ type: 'error', text: err })
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to load positions' })
    }
  }, [accountId])

  const [allPositions, setAllPositions] = useState<{ account_id: string; label: string; positions: Position[] }[]>([])
  const fetchAllPositions = useCallback(async () => {
    try {
      const r = await fetch(`${API}/positions/all`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.results)) {
        setAllPositions(data.results.map((x: { account_id: string; label: string; positions: Position[] }) => ({
          account_id: x.account_id,
          label: x.label,
          positions: Array.isArray(x.positions) ? x.positions : [],
        })))
      }
    } catch (_) {
      setAllPositions([])
    }
  }, [])

  type HedgePair = {
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
  type LiveAccountPositions = { account_id: string; label: string; positions: Position[] }
  const [hedgePairs, setHedgePairs] = useState<HedgePair[]>([])
  const [liveResults, setLiveResults] = useState<LiveAccountPositions[]>([])
  const [liveLastUpdate, setLiveLastUpdate] = useState<Date | null>(null)
  const [liveConnected, setLiveConnected] = useState(false)
  const hedgePairsRef = useRef<HedgePair[]>([])
  const panelSlTpClosingRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    hedgePairsRef.current = hedgePairs
  }, [hedgePairs])
  const fetchHedgePairs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/hedge-pairs`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.pairs)) {
        setHedgePairs(data.pairs)
      } else {
        setHedgePairs([])
      }
    } catch (_) {
      setHedgePairs([])
    }
  }, [])
  useEffect(() => {
    fetchHedgePairs()
  }, [fetchHedgePairs])

  useEffect(() => {
    const getWsUrl = () => `${getPanelWsBase()}/ws/positions`
    const pipSize = (symbol: string) => (symbol.includes('JPY') ? 0.01 : 0.0001)
    const ws = new WebSocket(getWsUrl())
    ws.onopen = () => setLiveConnected(true)
    ws.onclose = () => setLiveConnected(false)
    ws.onerror = () => setLiveConnected(false)
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          ok?: boolean
          results?: LiveAccountPositions[]
          prices?: Record<string, { bid: number; ask: number }>
        }
        if (data.ok && Array.isArray(data.results)) {
          setLiveResults(
            data.results.map((x) => ({
              account_id: x.account_id,
              label: x.label,
              positions: Array.isArray(x.positions) ? x.positions : [],
            }))
          )
          setLiveLastUpdate(new Date())

          const currentPairs = hedgePairsRef.current
          const prices = data.prices ?? {}
          const allPositions = (data.results ?? []).flatMap((r) => r.positions)
          const posByTicket = new Map(allPositions.map((p) => [p.ticket, p]))

          currentPairs.forEach((pair, index) => {
            if (
              panelSlTpClosingRef.current.has(index) ||
              pair.type_0 == null ||
              pair.type_1 == null ||
              pair.sl_pips_0 == null ||
              pair.tp_pips_0 == null ||
              pair.sl_pips_1 == null ||
              pair.tp_pips_1 == null
            )
              return
            const p0 = posByTicket.get(pair.ticket_0)
            const p1 = posByTicket.get(pair.ticket_1)
            if (!p0 || !p1) return
            const pip = pipSize(pair.symbol)
            const bid = prices[pair.symbol]?.bid
            const ask = prices[pair.symbol]?.ask
            if (bid == null || ask == null) return

            const sl0 = pair.type_0 === 'buy' ? p0.price_open - (pair.sl_pips_0 ?? 0) * pip : p0.price_open + (pair.sl_pips_0 ?? 0) * pip
            const tp0 = pair.type_0 === 'buy' ? p0.price_open + (pair.tp_pips_0 ?? 0) * pip : p0.price_open - (pair.tp_pips_0 ?? 0) * pip
            const sl1 = pair.type_1 === 'buy' ? p1.price_open - (pair.sl_pips_1 ?? 0) * pip : p1.price_open + (pair.sl_pips_1 ?? 0) * pip
            const tp1 = pair.type_1 === 'buy' ? p1.price_open + (pair.tp_pips_1 ?? 0) * pip : p1.price_open - (pair.tp_pips_1 ?? 0) * pip
            const hit0 = pair.type_0 === 'buy' ? bid <= sl0 || bid >= tp0 : ask >= sl0 || ask <= tp0
            const hit1 = pair.type_1 === 'buy' ? bid <= sl1 || bid >= tp1 : ask >= sl1 || ask <= tp1
            if (hit0 || hit1) {
              panelSlTpClosingRef.current.add(index)
              fetch(`${API}/hedge-close-pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index }),
              })
                .then((res) => res.json().catch(() => ({})))
                .then((d) => {
                  if (d.ok) fetchHedgePairs()
                  panelSlTpClosingRef.current.delete(index)
                })
                .catch(() => panelSlTpClosingRef.current.delete(index))
            }
          })
        }
      } catch (_) {}
    }
    return () => {
      ws.close()
      setLiveConnected(false)
    }
  }, [fetchHedgePairs])

  type AccountDeals = { account_id: string; label: string; deals: { ticket: number; time: number; symbol: string; type: string; volume: number; price: number; profit: number; swap?: number; commission?: number; entry?: number; position_id?: number; comment: string }[] }
  const [allHistory, setAllHistory] = useState<AccountDeals[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const fetchAllHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const r = await fetch(`${API}/history/all`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.results)) {
        setAllHistory(data.results.map((x: AccountDeals) => ({
          account_id: x.account_id,
          label: x.label,
          deals: Array.isArray(x.deals) ? x.deals : [],
        })))
      } else {
        setAllHistory([])
      }
    } catch (_) {
      setAllHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      await fetchAccounts()
      await Promise.all([fetchSymbols(), fetchPositions()])
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [fetchAccounts, fetchSymbols, fetchPositions])

  const isFirstAccountLoad = useRef(true)
  useEffect(() => {
    if (isFirstAccountLoad.current) {
      isFirstAccountLoad.current = false
      return
    }
    if (!loading && accounts.length > 0) {
      fetchSymbols()
      fetchPositions()
    }
  }, [accountId])

  useEffect(() => {
    if (currentPage === 'positions' && !loading) fetchAllPositions()
  }, [currentPage, loading, fetchAllPositions])

  useEffect(() => {
    if (currentPage === 'history') fetchAllHistory()
  }, [currentPage, fetchAllHistory])

  useEffect(() => {
    if (currentPage === 'settings' && !loading && symbols.length === 0) fetchSymbols()
  }, [currentPage, loading, symbols.length, fetchSymbols])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!symbol.trim()) {
      setMsg({ type: 'error', text: 'Select a symbol' })
      return
    }
    setSubmitting(true)
    try {
      // Manual create: always use the volume from the input (worker uses random range in its own flow)
      const vol = Math.max(0.0001, Number(volume) || 0.01)
      const body: Record<string, unknown> = {
        symbol: symbol.trim(),
        order_type: orderType,
        volume: vol,
        account_id: placeOnBoth || placeMasterSlaveHedge ? undefined : accountId,
      }
      if (comment.trim()) body.comment = comment.trim()
      if (stopLoss.trim()) body.stop_loss = Number(stopLoss)
      if (takeProfit.trim()) body.take_profit = Number(takeProfit)

      const defPips = defaultSlTpPips()
      if (placeMasterSlaveHedge) {
        // Exness master + slave same direction, Broker B opposite
        const r = await fetch(`${API}/positions/master-slave-hedge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: body.symbol, order_type: orderType, volume: vol, comment: body.comment || '' }),
        })
        const data = await r.json().catch(() => ({}))
        if (data.results) {
          const lines = data.results.map((x: { label: string; ok: boolean; message: string }) =>
            `${x.label}: ${x.ok ? 'Order placed' : x.message || 'Failed'}`
          )
          const text = data.message ? `${data.message} (${lines.join('. ')})` : lines.join('. ')
          setMsg({ type: data.ok ? 'success' : 'error', text })
          if (data.ok) fetchPositions()
        } else {
          setMsg({ type: 'error', text: data.message || data.error || 'Order failed' })
        }
        setSubmitting(false)
        return
      }
      if (placeOnBoth && accounts.length >= 2) {
        // Panel SL/TP: always send pips for pair (10/30 and 30/10 from Settings). Panel stores them and closes both when hit; MT5 gets no SL/TP.
        const st: Record<string, SlTpPips> = {}
        accounts.forEach((a) => {
          st[a.id] = slTpPipsByAccount[a.id] ?? defPips[a.id] ?? defPips.default ?? { sl_pips: 10, tp_pips: 30 }
        })
        body.sl_tp_pips = st
      } else if (!placeOnBoth && !placeMasterSlaveHedge) {
        if (useSlTp) {
          const pips = slTpPipsByAccount[accountId] ?? defPips[accountId] ?? defPips.default
          if (pips) {
            body.sl_pips = pips.sl_pips
            body.tp_pips = pips.tp_pips
          }
        } else {
          body.sl_pips = 0
          body.tp_pips = 0
        }
      }

      const url = placeOnBoth ? `${API}/positions/both` : `${API}/positions`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))

      if (placeOnBoth && data.results) {
        const lines = data.results.map((x: { label: string; ok: boolean; message: string }) =>
          `${x.label}: ${x.ok ? 'Order placed' : x.message || 'Failed'}`
        )
        const text = data.message ? `${data.message} (${lines.join('. ')})` : lines.join('. ')
        setMsg({
          type: data.ok ? 'success' : 'error',
          text,
        })
        if (data.ok) fetchPositions()
      } else if (data.ok) {
        setMsg({ type: 'success', text: data.message || 'Order placed' })
        fetchPositions()
      } else {
        setMsg({ type: 'error', text: data.message || data.error || 'Order failed' })
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Request failed' })
    } finally {
      setSubmitting(false)
    }
  }

  const nav = (page: Page, label: string) => (
    <a
      href={`#${page}`}
      className={currentPage === page ? 'active' : ''}
      onClick={() => setNavOpen(false)}
    >
      {label}
    </a>
  )

  const pageTitles: Record<Page, string> = {
    positions: 'Bot Positions',
    history: 'Positions History',
    livepositions: 'Live Positions',
    trading: 'Bot Trading',
    settings: 'Bot Settings',
    fixedlot: 'Single account (random lot)',
    exnessclones: 'Exness terminal clones',
  }

  return (
    <div className={`admin-layout${navOpen ? ' admin-layout--nav-open' : ''}`}>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close navigation"
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />
      <aside className={`sidebar${navOpen ? ' sidebar--open' : ''}`} id="app-sidebar">
        <div className="sidebar-brand">MT5 Bot</div>
        <nav className="sidebar-nav" aria-label="Main">
          {nav('positions', 'Bot Positions')}
          {nav('history', 'Positions History')}
          {nav('livepositions', 'Live Positions')}
          {nav('trading', 'Bot Trading')}
          {nav('fixedlot', 'Single account (random lot)')}
          {nav('exnessclones', 'Exness terminal clones')}
          {nav('settings', 'Bot Settings')}
        </nav>
      </aside>
      <main className="main-content">
        <header className="mobile-nav-bar">
          <button
            type="button"
            className="mobile-nav-toggle"
            onClick={() => setNavOpen(true)}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            aria-label="Open navigation menu"
          >
            <span className="mobile-nav-toggle-bars" aria-hidden />
          </button>
          <span className="mobile-nav-title">{pageTitles[currentPage]}</span>
        </header>
        <h1 className="page-header page-header--desktop">{pageTitles[currentPage]}</h1>
        {loading ? (
          <div className="card">
            <p className="loading">Connecting to MT5…</p>
          </div>
        ) : (
          <>
            {currentPage === 'positions' && (
              <BotPositions
                allPositions={allPositions}
                onRefresh={fetchAllPositions}
              />
            )}
            {currentPage === 'history' && (
              <BotHistory
                allHistory={allHistory}
                historyLoading={historyLoading}
                onRefresh={fetchAllHistory}
              />
            )}
            {currentPage === 'livepositions' && (
              <BotLivePositions
                results={liveResults}
                lastUpdate={liveLastUpdate}
                connected={liveConnected}
                pairs={hedgePairs}
                onRefreshPairs={fetchHedgePairs}
              />
            )}
            {currentPage === 'fixedlot' && <FixedLot />}
            {currentPage === 'exnessclones' && <ExnessClones />}
            {currentPage === 'trading' && (
              <BotTrading
                accounts={accounts}
                accountId={accountId}
                setAccountId={setAccountId}
                symbols={symbols}
                connectionError={connectionError}
                onRetrySymbols={() => { setConnectionError(null); fetchSymbols() }}
                fetchSymbols={fetchSymbols}
                msg={msg}
                symbol={symbol}
                setSymbol={setSymbol}
                orderType={orderType}
                setOrderType={setOrderType}
                volume={volume}
                setVolume={setVolume}
                stopLoss={stopLoss}
                setStopLoss={setStopLoss}
                takeProfit={takeProfit}
                setTakeProfit={setTakeProfit}
                comment={comment}
                setComment={setComment}
                placeOnBoth={placeOnBoth}
                setPlaceOnBoth={setPlaceOnBoth}
                placeMasterSlaveHedge={placeMasterSlaveHedge}
                setPlaceMasterSlaveHedge={setPlaceMasterSlaveHedge}
                submitting={submitting}
                onSubmit={handleSubmit}
                workerMinVolume={workerMinVolume}
                workerMaxVolume={workerMaxVolume}
              />
            )}
            {currentPage === 'settings' && (
              <BotSettings
                accounts={accounts}
                useSlTp={useSlTp}
                setUseSlTp={setUseSlTp}
                slTpPipsByAccount={slTpPipsByAccount}
                setSlTpPips={(accountId, sl_pips, tp_pips) =>
                  setSlTpPipsByAccount((prev) => ({ ...prev, [accountId]: { sl_pips, tp_pips } }))
                }
                workerEnabled={workerEnabled}
                setWorkerEnabled={setWorkerEnabled}
                workerFixedInterval={workerFixedInterval}
                setWorkerFixedInterval={setWorkerFixedInterval}
                workerIntervalMinutes={workerIntervalMinutes}
                setWorkerIntervalMinutes={setWorkerIntervalMinutes}
                workerMinMinutes={workerMinMinutes}
                setWorkerMinMinutes={setWorkerMinMinutes}
                workerMaxMinutes={workerMaxMinutes}
                setWorkerMaxMinutes={setWorkerMaxMinutes}
                workerSymbols={workerSymbols}
                setWorkerSymbols={setWorkerSymbols}
                workerMinVolume={workerMinVolume}
                setWorkerMinVolume={setWorkerMinVolume}
                workerMaxVolume={workerMaxVolume}
                setWorkerMaxVolume={setWorkerMaxVolume}
                workerPlaceMode={workerPlaceMode}
                setWorkerPlaceMode={setWorkerPlaceMode}
                workerMaxOpenPositions={workerMaxOpenPositions}
                setWorkerMaxOpenPositions={setWorkerMaxOpenPositions}
                workerLastRun={workerLastRun}
                workerNextRunAt={workerNextRunAt}
                workerRunCount={workerRunCount}
                onResetWorkerCounter={() => {
                  workerSkipNextPatchRef.current = true
                  patchWorkerConfig({ resetRunCount: true }).then((data) => data && applyWorkerConfigToState(data))
                }}
                workerFailedPositions={workerFailedPositions}
                onClearFailedPositions={() => {
                  workerSkipNextPatchRef.current = true
                  patchWorkerConfig({ clearFailedPositions: true }).then((data) => data && applyWorkerConfigToState(data))
                }}
                onResetWorkerBalance={() => {
                  workerSkipNextPatchRef.current = true
                  patchWorkerConfig({ resetBalance: true }).then((data) => data && applyWorkerConfigToState(data))
                }}
                onRunNow={async () => {
                  workerSkipNextPatchRef.current = true
                  await workerRunOnce()
                  const data = await fetchWorkerConfig()
                  if (data) applyWorkerConfigToState(data)
                }}
                symbols={symbols}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
