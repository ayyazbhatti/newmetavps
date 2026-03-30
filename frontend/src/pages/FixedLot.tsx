import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getPanelWsBase } from '../panelWsBase'
import './FixedLot.css'

const API = '/api'
const FIXEDLOT_STORAGE_KEY = 'fixedlot_settings'

type Account = { id: string; label: string }

const FIXED_ACCOUNTS: Account[] = [
  { id: 'default', label: 'IC Markets (MT5 Default)' },
  { id: 'exness', label: 'Exness (MT5 - EXNESS)' },
]

/** Preset: major USD pairs (no suffix). */
const MAJOR_USD_SYMBOLS = [
  'AUDUSD', 'EURUSD', 'GBPUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDCNH', 'USDJPY', 'USDSEK',
]
/** Preset: common symbols with "m" suffix (e.g. Exness). Selection is persisted. */
const MAJOR_M_SYMBOLS = [
  'AUDUSDm', 'BTCUSDm', 'ETHUSDm', 'EURUSDm', 'GBPUSDm', 'USDCHFm', 'USDJPYm', 'XAUUSDm',
]

type FixedLotSaved = {
  accountId?: string
  minVolume?: number
  maxVolume?: number
  minIntervalMinutes?: number
  maxIntervalMinutes?: number
  selectedSymbols?: string[]
  intervalEnabled?: boolean
  lastDirection?: 'buy' | 'sell'
  maxOpenPositions?: number
  maxSpreadFilterEnabled?: boolean
  maxSpreadPips?: number
  telegramAlertEnabled?: boolean
  telegramAlertBelowPips?: number
  telegramAlertCooldownSeconds?: number
}

function loadFixedLotSettings(): FixedLotSaved {
  try {
    const raw = localStorage.getItem(FIXEDLOT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as FixedLotSaved
    return parsed
  } catch {
    return {}
  }
}

function saveFixedLotSettingsLocal(s: FixedLotSaved) {
  try {
    localStorage.setItem(FIXEDLOT_STORAGE_KEY, JSON.stringify(s))
  } catch (_) {}
}

function randomVolume(min: number, max: number): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const range = (hi - lo) || 0
  const v = lo + Math.random() * range
  return Math.round(v * 100) / 100
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'any moment'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min > 0) return `${min} min ${sec} sec`
  return `${sec} sec`
}

function fixedLotWsUrl(accountId: string, symbolsCsv: string): string {
  const q = new URLSearchParams({
    account_id: accountId,
    symbols: symbolsCsv,
  })
  return `${getPanelWsBase()}/ws/symbol-ticks?${q.toString()}`
}

function formatQuotePrice(symbol: string, v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = symbol.toUpperCase()
  const digits = s.includes('JPY') || s.includes('XAU') || s.includes('XAG') ? 3 : 5
  return v.toFixed(digits)
}

/** One pip in price units (for spread → pips). Matches typical MT5 FX / metals / crypto naming. */
function pipSizeForSpread(symbol: string): number {
  const s = symbol.toUpperCase()
  if (s.includes('JPY')) return 0.01
  if (s.includes('XAU') || s.includes('XAG')) return 0.01
  if (s.includes('BTC') || s.includes('ETH')) return 0.01
  return 0.0001
}

function formatSpreadCell(symbol: string, spread: number | undefined): string {
  if (spread == null || !Number.isFinite(spread)) return '—'
  const pip = pipSizeForSpread(symbol)
  const pips = spread / pip
  const pipsStr = pips >= 10 ? pips.toFixed(1) : pips.toFixed(2)
  return `${formatQuotePrice(symbol, spread)} (${pipsStr} pips)`
}

/** Current spread in pips, or null if bid/ask invalid. */
function spreadInPips(symbol: string, bid: number, ask: number): number | null {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid) return null
  const pip = pipSizeForSpread(symbol)
  if (pip <= 0) return null
  return (ask - bid) / pip
}

function NextRunCountdown({ nextRunAt }: { nextRunAt: Date }) {
  const [label, setLabel] = useState(() => formatCountdown(nextRunAt.getTime() - Date.now()))
  useEffect(() => {
    const tick = () => setLabel(formatCountdown(nextRunAt.getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextRunAt])
  return <>{label}</>
}

export default function FixedLot() {
  const [accountId, setAccountId] = useState<string>('default')
  const [minVolume, setMinVolume] = useState(0.01)
  const [maxVolume, setMaxVolume] = useState(0.1)
  const [minIntervalMinutes, setMinIntervalMinutes] = useState(10)
  const [maxIntervalMinutes, setMaxIntervalMinutes] = useState(15)
  const [symbols, setSymbols] = useState<string[]>([])
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [closingAll, setClosingAll] = useState(false)
  const [sendingTelegramTest, setSendingTelegramTest] = useState(false)
  const [intervalEnabled, setIntervalEnabled] = useState(false)
  const [scheduleKey, setScheduleKey] = useState(0)
  const [lastDirection, setLastDirection] = useState<'buy' | 'sell' | null>(null)
  const [maxOpenPositions, setMaxOpenPositions] = useState(0)
  const [maxSpreadFilterEnabled, setMaxSpreadFilterEnabled] = useState(false)
  const [maxSpreadPips, setMaxSpreadPips] = useState(2)
  const [telegramAlertEnabled, setTelegramAlertEnabled] = useState(false)
  const [telegramAlertBelowPips, setTelegramAlertBelowPips] = useState(0.2)
  const [telegramAlertCooldownSeconds, setTelegramAlertCooldownSeconds] = useState(300)
  const [telegramSubscribersCount, setTelegramSubscribersCount] = useState<number | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const skipNextPersistRef = useRef(true)
  const [nextRunAt, setNextRunAt] = useState<Date | null>(null)
  const [liveTicks, setLiveTicks] = useState<Record<string, { bid: number; ask: number }>>({})
  const liveTicksRef = useRef(liveTicks)
  liveTicksRef.current = liveTicks
  const [quotesWsConnected, setQuotesWsConnected] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runNowRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const prevSpreadRef = useRef<Record<string, number | null>>({})
  const telegramNotifyInFlightRef = useRef<Set<string>>(new Set())

  const selectedSymbolsKey = useMemo(() => [...selectedSymbols].sort().join(','), [selectedSymbols])

  useEffect(() => {
    if (!selectedSymbolsKey) {
      setLiveTicks({})
      setQuotesWsConnected(false)
      return
    }
    const url = fixedLotWsUrl(accountId, selectedSymbolsKey)
    const ws = new WebSocket(url)
    ws.onopen = () => setQuotesWsConnected(true)
    ws.onclose = () => {
      setQuotesWsConnected(false)
      setLiveTicks({})
    }
    ws.onerror = () => setQuotesWsConnected(false)
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          ok?: boolean
          ticks?: Record<string, { bid?: number; ask?: number }>
        }
        if (!data.ok || !data.ticks || typeof data.ticks !== 'object') return
        const next: Record<string, { bid: number; ask: number }> = {}
        for (const [sym, t] of Object.entries(data.ticks)) {
          const bid = t?.bid
          const ask = t?.ask
          if (typeof bid === 'number' && typeof ask === 'number') next[sym] = { bid, ask }
        }
        setLiveTicks(next)
      } catch {
        /* ignore */
      }
    }
    return () => {
      ws.close()
      setQuotesWsConnected(false)
    }
  }, [accountId, selectedSymbolsKey])

  /** Load settings from panel API (shared across browsers); migrate legacy localStorage once. */
  useEffect(() => {
    let cancelled = false
    const applyFromRecord = (data: Record<string, unknown>) => {
      if (typeof data.accountId === 'string') setAccountId(data.accountId)
      if (typeof data.minVolume === 'number' && Number.isFinite(data.minVolume)) setMinVolume(data.minVolume)
      if (typeof data.maxVolume === 'number' && Number.isFinite(data.maxVolume)) setMaxVolume(data.maxVolume)
      if (typeof data.minIntervalMinutes === 'number' && Number.isFinite(data.minIntervalMinutes)) {
        setMinIntervalMinutes(data.minIntervalMinutes)
      }
      if (typeof data.maxIntervalMinutes === 'number' && Number.isFinite(data.maxIntervalMinutes)) {
        setMaxIntervalMinutes(data.maxIntervalMinutes)
      }
      if (Array.isArray(data.selectedSymbols)) setSelectedSymbols([...data.selectedSymbols])
      if (typeof data.intervalEnabled === 'boolean') setIntervalEnabled(data.intervalEnabled)
      const ld = data.lastDirection
      if (ld === 'buy' || ld === 'sell') setLastDirection(ld)
      else setLastDirection(null)
      if (typeof data.maxOpenPositions === 'number' && Number.isFinite(data.maxOpenPositions)) {
        setMaxOpenPositions(Math.max(0, Math.floor(data.maxOpenPositions)))
      }
      if (typeof data.maxSpreadFilterEnabled === 'boolean') setMaxSpreadFilterEnabled(data.maxSpreadFilterEnabled)
      if (typeof data.maxSpreadPips === 'number' && Number.isFinite(data.maxSpreadPips)) {
        setMaxSpreadPips(Math.max(0, data.maxSpreadPips))
      }
      if (typeof data.telegramAlertEnabled === 'boolean') setTelegramAlertEnabled(data.telegramAlertEnabled)
      if (typeof data.telegramAlertBelowPips === 'number' && Number.isFinite(data.telegramAlertBelowPips)) {
        setTelegramAlertBelowPips(Math.max(0, data.telegramAlertBelowPips))
      }
      if (
        typeof data.telegramAlertCooldownSeconds === 'number' &&
        Number.isFinite(data.telegramAlertCooldownSeconds)
      ) {
        setTelegramAlertCooldownSeconds(Math.max(10, Math.floor(data.telegramAlertCooldownSeconds)))
      }
    }

    ;(async () => {
      try {
        const r = await fetch(`${API}/fixedlot/settings`, { cache: 'no-store' })
        const data = (await r.json()) as Record<string, unknown>
        if (cancelled || !r.ok || data.ok !== true) throw new Error('bad')
        applyFromRecord(data)

        const local = loadFixedLotSettings()
        const serverSyms = Array.isArray(data.selectedSymbols) ? (data.selectedSymbols as string[]) : []
        const localSyms = local.selectedSymbols ?? []
        if (localSyms.length > 0 && serverSyms.length === 0) {
          const merged = {
            accountId: (typeof data.accountId === 'string' ? data.accountId : local.accountId) ?? 'default',
            minVolume: (typeof data.minVolume === 'number' ? data.minVolume : local.minVolume) ?? 0.01,
            maxVolume: (typeof data.maxVolume === 'number' ? data.maxVolume : local.maxVolume) ?? 0.1,
            minIntervalMinutes:
              (typeof data.minIntervalMinutes === 'number' ? data.minIntervalMinutes : local.minIntervalMinutes) ?? 10,
            maxIntervalMinutes:
              (typeof data.maxIntervalMinutes === 'number' ? data.maxIntervalMinutes : local.maxIntervalMinutes) ?? 15,
            selectedSymbols: localSyms,
            intervalEnabled:
              (typeof data.intervalEnabled === 'boolean' ? data.intervalEnabled : local.intervalEnabled) ?? false,
            lastDirection: local.lastDirection ?? null,
            maxOpenPositions:
              (typeof data.maxOpenPositions === 'number' ? data.maxOpenPositions : local.maxOpenPositions) ?? 0,
            maxSpreadFilterEnabled:
              (typeof data.maxSpreadFilterEnabled === 'boolean'
                ? data.maxSpreadFilterEnabled
                : local.maxSpreadFilterEnabled) ?? false,
            maxSpreadPips: (typeof data.maxSpreadPips === 'number' ? data.maxSpreadPips : local.maxSpreadPips) ?? 2,
            telegramAlertEnabled:
              (typeof data.telegramAlertEnabled === 'boolean'
                ? data.telegramAlertEnabled
                : local.telegramAlertEnabled) ?? false,
            telegramAlertBelowPips:
              (typeof data.telegramAlertBelowPips === 'number'
                ? data.telegramAlertBelowPips
                : local.telegramAlertBelowPips) ?? 0.2,
            telegramAlertCooldownSeconds:
              (typeof data.telegramAlertCooldownSeconds === 'number'
                ? data.telegramAlertCooldownSeconds
                : local.telegramAlertCooldownSeconds) ?? 300,
          }
          applyFromRecord(merged)
          await fetch(`${API}/fixedlot/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(merged),
          })
          try {
            localStorage.removeItem(FIXEDLOT_STORAGE_KEY)
          } catch (_) {
            /* ignore */
          }
          skipNextPersistRef.current = true
        } else {
          try {
            localStorage.removeItem(FIXEDLOT_STORAGE_KEY)
          } catch (_) {
            /* ignore */
          }
        }
      } catch {
        if (!cancelled) {
          const local = loadFixedLotSettings()
          applyFromRecord({
            accountId: local.accountId ?? 'default',
            minVolume: local.minVolume ?? 0.01,
            maxVolume: local.maxVolume ?? 0.1,
            minIntervalMinutes: local.minIntervalMinutes ?? 10,
            maxIntervalMinutes: local.maxIntervalMinutes ?? 15,
            selectedSymbols: local.selectedSymbols ?? [],
            intervalEnabled: local.intervalEnabled ?? false,
            lastDirection: local.lastDirection ?? null,
            maxOpenPositions: local.maxOpenPositions ?? 0,
            maxSpreadFilterEnabled: local.maxSpreadFilterEnabled ?? false,
            maxSpreadPips: local.maxSpreadPips ?? 2,
            telegramAlertEnabled: local.telegramAlertEnabled ?? false,
            telegramAlertBelowPips: local.telegramAlertBelowPips ?? 0.2,
            telegramAlertCooldownSeconds: local.telegramAlertCooldownSeconds ?? 300,
          })
          setMsg({
            type: 'error',
            text: 'Could not load settings from server; showing data saved in this browser only.',
          })
        }
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true)
          skipNextPersistRef.current = true
          setScheduleKey((k) => k + 1)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Persist to panel server (same settings for all devices using this API). */
  useEffect(() => {
    if (!settingsLoaded) return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }
    const payload = {
      accountId,
      minVolume,
      maxVolume,
      minIntervalMinutes,
      maxIntervalMinutes,
      selectedSymbols,
      intervalEnabled,
      lastDirection,
      maxOpenPositions,
      maxSpreadFilterEnabled,
      maxSpreadPips,
      telegramAlertEnabled,
      telegramAlertBelowPips,
      telegramAlertCooldownSeconds,
    }
    const t = window.setTimeout(() => {
      fetch(`${API}/fixedlot/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      })
        .then((r) => {
          if (r.ok) {
            try {
              localStorage.removeItem(FIXEDLOT_STORAGE_KEY)
            } catch (_) {
              /* ignore */
            }
            return
          }
          saveFixedLotSettingsLocal({
            ...payload,
            lastDirection: lastDirection ?? undefined,
          })
          setMsg({ type: 'error', text: 'Could not save settings to server. Check connection to the panel API.' })
        })
        .catch(() => {
          saveFixedLotSettingsLocal({
            ...payload,
            lastDirection: lastDirection ?? undefined,
          })
          setMsg({ type: 'error', text: 'Could not save settings to server. Check connection to the panel API.' })
        })
    }, 450)
    return () => clearTimeout(t)
  }, [
    settingsLoaded,
    accountId,
    minVolume,
    maxVolume,
    minIntervalMinutes,
    maxIntervalMinutes,
    selectedSymbols,
    intervalEnabled,
    lastDirection,
    maxOpenPositions,
    maxSpreadFilterEnabled,
    maxSpreadPips,
    telegramAlertEnabled,
    telegramAlertBelowPips,
    telegramAlertCooldownSeconds,
  ])

  /** Telegram alert: when spread crosses from >= threshold to < threshold. */
  useEffect(() => {
    if (!telegramAlertEnabled || telegramAlertBelowPips <= 0) {
      prevSpreadRef.current = {}
      return
    }
    const nextPrev: Record<string, number | null> = { ...prevSpreadRef.current }
    for (const sym of selectedSymbols) {
      const t = liveTicks[sym]
      if (!t) {
        nextPrev[sym] = null
        continue
      }
      const current = spreadInPips(sym, t.bid, t.ask)
      const previous = prevSpreadRef.current[sym]
      if (
        current != null &&
        previous != null &&
        previous >= telegramAlertBelowPips &&
        current < telegramAlertBelowPips
      ) {
        const key = `${accountId}:${sym}`
        if (!telegramNotifyInFlightRef.current.has(key)) {
          telegramNotifyInFlightRef.current.add(key)
          fetch(`${API}/fixedlot/notify-spread-below`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accountId,
              symbol: sym,
              spreadPips: current,
              thresholdPips: telegramAlertBelowPips,
            }),
          })
            .then(async (r) => {
              const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; sent?: boolean }
              if (!r.ok || data.ok === false) {
                setMsg({ type: 'error', text: data.error || 'Telegram spread alert failed' })
              } else if (data.sent) {
                setMsg({
                  type: 'success',
                  text: `Telegram alert sent: ${sym} spread ${current.toFixed(2)} pips (< ${telegramAlertBelowPips})`,
                })
              }
            })
            .catch(() => {
              setMsg({ type: 'error', text: 'Telegram spread alert request failed' })
            })
            .finally(() => {
              telegramNotifyInFlightRef.current.delete(key)
            })
        }
      }
      nextPrev[sym] = current
    }
    prevSpreadRef.current = nextPrev
  }, [accountId, liveTicks, selectedSymbols, telegramAlertEnabled, telegramAlertBelowPips])

  const fetchSymbols = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const r = await fetch(`${API}/symbols?account_id=${encodeURIComponent(accountId)}`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && Array.isArray(data.symbols)) {
        setSymbols(data.symbols)
      } else {
        setSymbols([])
        setMsg({ type: 'error', text: data.error || data.message || 'Could not load symbols' })
      }
    } catch {
      setSymbols([])
      setMsg({ type: 'error', text: 'Failed to fetch symbols' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    fetchSymbols()
  }, [fetchSymbols])

  /**
   * Do NOT strip saved selections against the broker list on every symbols refresh.
   * Many accounts use suffixed symbols (e.g. EURUSDm) while presets save plain names (EURUSD);
   * filtering would wipe the selection and make it look like "not saving".
   * Only trim selections when the user switches account so invalid tickets for the new account drop off.
   */
  const fixedlotAccountFilterRef = useRef<string | null>(null)
  useEffect(() => {
    if (symbols.length === 0) return
    if (fixedlotAccountFilterRef.current === null) {
      fixedlotAccountFilterRef.current = accountId
      return
    }
    if (fixedlotAccountFilterRef.current !== accountId) {
      fixedlotAccountFilterRef.current = accountId
      setSelectedSymbols((prev) => prev.filter((s) => symbols.includes(s)))
    }
  }, [accountId, symbols])

  const toggleSymbol = (s: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort()
    )
  }
  const selectAll = () => setSelectedSymbols([...symbols].sort())
  const clearAll = () => setSelectedSymbols([])
  /** Select only major USD pairs (from preset list) that exist in current symbols; persisted via useEffect. */
  const selectMajorUsd = () => {
    const available = MAJOR_USD_SYMBOLS.filter((s) => symbols.includes(s))
    setSelectedSymbols([...available].sort())
  }
  /** Select preset with "m" suffix symbols (e.g. AUDUSDm, BTCUSDm); persisted via useEffect. */
  const selectMajorM = () => {
    const available = MAJOR_M_SYMBOLS.filter((s) => symbols.includes(s))
    setSelectedSymbols([...available].sort())
  }

  const pool = selectedSymbols.length > 0 ? selectedSymbols : symbols

  const closeAllPositions = useCallback(async () => {
    const label = FIXED_ACCOUNTS.find((a) => a.id === accountId)?.label ?? accountId
    if (
      !window.confirm(
        `Close all open positions on "${label}"?\n\nSame API as Live Positions; this cannot be undone.`,
      )
    ) {
      return
    }
    setClosingAll(true)
    setMsg(null)
    try {
      const r = await fetch(
        `${API}/positions/close-all?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST' },
      )
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        message?: string
        failed_count?: number
      }
      if (!r.ok) {
        setMsg({ type: 'error', text: data.error || data.message || 'Close all failed' })
        return
      }
      const failed = typeof data.failed_count === 'number' ? data.failed_count : 0
      const ok = data.ok !== false && failed === 0
      setMsg({
        type: ok ? 'success' : 'error',
        text:
          typeof data.message === 'string'
            ? data.message
            : failed > 0
              ? 'Some positions failed to close'
              : 'Done',
      })
    } catch {
      setMsg({ type: 'error', text: 'Close all request failed' })
    } finally {
      setClosingAll(false)
    }
  }, [accountId])

  const sendTelegramTestAlert = useCallback(async () => {
    setSendingTelegramTest(true)
    setMsg(null)
    const preferredSymbol = selectedSymbols[0] ?? symbols[0] ?? 'EURUSD'
    try {
      const r = await fetch(`${API}/fixedlot/test-telegram-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, symbol: preferredSymbol }),
      })
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        message?: string
        sent?: boolean
      }
      if (!r.ok || data.ok === false) {
        setMsg({ type: 'error', text: data.error || data.message || 'Telegram test failed' })
        return
      }
      setMsg({ type: 'success', text: data.message || 'Test Telegram alert sent' })
    } catch {
      setMsg({ type: 'error', text: 'Telegram test request failed' })
    } finally {
      setSendingTelegramTest(false)
    }
  }, [accountId, selectedSymbols, symbols])

  const refreshTelegramSubscribers = useCallback(async () => {
    try {
      const r = await fetch(`${API}/fixedlot/telegram-subscribers`, { cache: 'no-store' })
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; count?: number }
      if (r.ok && data.ok && typeof data.count === 'number') {
        setTelegramSubscribersCount(data.count)
      } else {
        setTelegramSubscribersCount(null)
      }
    } catch {
      setTelegramSubscribersCount(null)
    }
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    refreshTelegramSubscribers()
  }, [settingsLoaded, refreshTelegramSubscribers])

  const runNow = async () => {
    if (pool.length === 0) {
      setMsg({ type: 'error', text: 'No symbols. Load symbols and select at least one (or use Run now after selecting account).' })
      return
    }
    if (maxOpenPositions > 0) {
      try {
        const r = await fetch(`${API}/positions?account_id=${encodeURIComponent(accountId)}`)
        const data = await r.json().catch(() => ({}))
        const positions = Array.isArray(data?.positions) ? data.positions : []
        if (positions.length >= maxOpenPositions) {
          setMsg({ type: 'error', text: `Max open positions (${maxOpenPositions}) reached. Waiting for a position to close. Bot will try again on next run.` })
          return
        }
      } catch {
        setMsg({ type: 'error', text: 'Could not check open positions.' })
        return
      }
    }
    const symbol = pool[Math.floor(Math.random() * pool.length)]
    if (maxSpreadFilterEnabled) {
      const tick = liveTicksRef.current[symbol]
      if (!tick || typeof tick.bid !== 'number' || typeof tick.ask !== 'number') {
        setMsg({
          type: 'error',
          text: `Max spread filter on: no live bid/ask for ${symbol} yet. Wait for quotes (WebSocket) or disable the filter.`,
        })
        return
      }
      const spPips = spreadInPips(symbol, tick.bid, tick.ask)
      if (spPips == null) {
        setMsg({ type: 'error', text: `Max spread filter on: invalid quote for ${symbol}.` })
        return
      }
      if (spPips > maxSpreadPips) {
        setMsg({
          type: 'error',
          text: `Skipped: spread ${spPips.toFixed(2)} pips exceeds max ${maxSpreadPips} (${symbol}). Next run will try again.`,
        })
        return
      }
    }
    const vol = Math.max(0.01, randomVolume(minVolume, maxVolume))
    let orderType: 'buy' | 'sell'
    if (lastDirection === 'buy') {
      orderType = 'sell'
    } else if (lastDirection === 'sell') {
      orderType = 'buy'
    } else {
      orderType = Math.random() < 0.5 ? 'buy' : 'sell'
    }
    setLastDirection(orderType)
    setMsg(null)
    setSubmitting(true)
    try {
      const r = await fetch(`${API}/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          order_type: orderType,
          volume: vol,
          account_id: accountId,
          comment: 'fixedlot',
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (data?.ok) {
        const label = FIXED_ACCOUNTS.find((a) => a.id === accountId)?.label ?? accountId
        setMsg({ type: 'success', text: `Order placed: ${symbol} ${orderType} ${vol} lots on ${label}` })
      } else {
        setMsg({ type: 'error', text: data?.message || data?.error || 'Order failed' })
      }
    } catch {
      setMsg({ type: 'error', text: 'Request failed' })
    } finally {
      setSubmitting(false)
    }
  }

  runNowRef.current = runNow

  useEffect(() => {
    if (!intervalEnabled || pool.length === 0) {
      setNextRunAt(null)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }
    const minSec = Math.max(30, minIntervalMinutes * 60)
    const maxSec = Math.max(minSec, maxIntervalMinutes * 60)
    const delaySec = minSec + Math.random() * (maxSec - minSec)
    const at = new Date(Date.now() + delaySec * 1000)
    setNextRunAt(at)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      runNowRef.current().then(() => setScheduleKey((k) => k + 1))
    }, delaySec * 1000)
    return () => {
      setNextRunAt(null)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [intervalEnabled, minIntervalMinutes, maxIntervalMinutes, pool.length, scheduleKey])

  return (
    <div className="fixedlot-page">
      <div className="card fixedlot">
      <header className="fixedlot__header">
        <h2 className="fixedlot__title">Single-account worker</h2>
        <p className="fixedlot__subtitle">
          One MT5 account · random symbol &amp; lot · manual run or interval
        </p>
      </header>

      <section className="fixedlot__section" aria-labelledby="fixedlot-exec-title">
        <h3 id="fixedlot-exec-title" className="fixedlot__section-title">
          Execution
        </h3>
        <div className="fixedlot__grid">
          <div className="fixedlot__field fixedlot__field--account">
            <label htmlFor="fixedlot-account">Account</label>
            <select
              id="fixedlot-account"
              className="fixedlot__control"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {FIXED_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="fixedlot__field">
            <label htmlFor="fixedlot-min">Min lot</label>
            <input
              id="fixedlot-min"
              className="fixedlot__control"
              type="number"
              min={0.01}
              step={0.01}
              value={minVolume}
              onChange={(e) => setMinVolume(Math.max(0.01, Number(e.target.value) || 0.01))}
            />
          </div>
          <div className="fixedlot__field">
            <label htmlFor="fixedlot-max">Max lot</label>
            <input
              id="fixedlot-max"
              className="fixedlot__control"
              type="number"
              min={0.01}
              step={0.01}
              value={maxVolume}
              onChange={(e) => setMaxVolume(Math.max(0.01, Number(e.target.value) || 0.01))}
            />
          </div>
          <div className="fixedlot__field">
            <label htmlFor="fixedlot-max-positions">Max positions</label>
            <input
              id="fixedlot-max-positions"
              className="fixedlot__control"
              type="number"
              min={0}
              step={1}
              value={maxOpenPositions}
              onChange={(e) => setMaxOpenPositions(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              title="0 = unlimited. Pauses new orders at this count until one closes."
            />
          </div>
        </div>
      </section>

      <section className="fixedlot__section" aria-labelledby="fixedlot-risk-title">
        <h3 id="fixedlot-risk-title" className="fixedlot__section-title">
          Risk
        </h3>
        <div className="fixedlot__spread-row">
          <label
            className="toggle-label"
            title="Requires live quotes (select symbols). Skips run if spread in pips exceeds the limit."
          >
            <input
              type="checkbox"
              checked={maxSpreadFilterEnabled}
              onChange={(e) => setMaxSpreadFilterEnabled(e.target.checked)}
            />
            <span>Skip if spread &gt;</span>
          </label>
          <div className="fixedlot__spread-input">
            <input
              id="fixedlot-max-spread-pips"
              type="number"
              min={0}
              step={0.01}
              disabled={!maxSpreadFilterEnabled}
              aria-label="Maximum spread in pips"
              value={maxSpreadPips}
              onChange={(e) => {
                const v = Number(e.target.value)
                setMaxSpreadPips(Number.isFinite(v) && v >= 0 ? v : 0)
              }}
              title="Compared to live bid/ask (same pip rules as the table below)."
            />
            <span className="fixedlot__spread-suffix">pips</span>
          </div>
        </div>
        <div className="fixedlot__spread-row fixedlot__spread-row--telegram">
          <label
            className="toggle-label"
            title="When spread drops below threshold, send a Telegram alert (requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on server)."
          >
            <input
              type="checkbox"
              checked={telegramAlertEnabled}
              onChange={(e) => setTelegramAlertEnabled(e.target.checked)}
            />
            <span>Telegram alert if spread &lt;</span>
          </label>
          <div className="fixedlot__spread-input">
            <input
              id="fixedlot-telegram-spread-below-pips"
              type="number"
              min={0}
              step={0.01}
              disabled={!telegramAlertEnabled}
              aria-label="Telegram alert threshold spread in pips"
              value={telegramAlertBelowPips}
              onChange={(e) => {
                const v = Number(e.target.value)
                setTelegramAlertBelowPips(Number.isFinite(v) && v >= 0 ? v : 0)
              }}
              title="Alert triggers on crossing below this spread value."
            />
            <span className="fixedlot__spread-suffix">pips</span>
          </div>
          <div className="fixedlot__spread-input fixedlot__spread-input--cooldown">
            <input
              id="fixedlot-telegram-cooldown-sec"
              type="number"
              min={10}
              step={10}
              disabled={!telegramAlertEnabled}
              aria-label="Telegram alert cooldown seconds"
              value={telegramAlertCooldownSeconds}
              onChange={(e) => {
                const v = Number(e.target.value)
                setTelegramAlertCooldownSeconds(Number.isFinite(v) ? Math.max(10, Math.floor(v)) : 300)
              }}
              title="Minimum seconds between alerts for same account+symbol."
            />
            <span className="fixedlot__spread-suffix">sec cooldown</span>
          </div>
          <button
            type="button"
            className="fixedlot__btn-telegram-test"
            onClick={sendTelegramTestAlert}
            disabled={sendingTelegramTest}
            title="Send a one-time Telegram test message with current account/symbol."
          >
            {sendingTelegramTest ? 'Sending test…' : 'Send test alert'}
          </button>
        </div>
        <p className="fixedlot__telegram-subscribers">
          Telegram subscribers: <strong>{telegramSubscribersCount ?? '—'}</strong>
          {' · '}
          <button
            type="button"
            className="fixedlot__subscribers-refresh"
            onClick={refreshTelegramSubscribers}
            title="Refresh subscriber count (users who started/chatted with the bot)."
          >
            refresh
          </button>
        </p>
      </section>

      <section className="fixedlot__section" aria-labelledby="fixedlot-sched-title">
        <h3 id="fixedlot-sched-title" className="fixedlot__section-title">
          Schedule
        </h3>
        <div className="fixedlot__grid">
          <div className="fixedlot__field">
            <label htmlFor="fixedlot-min-int">Interval min</label>
            <input
              id="fixedlot-min-int"
              className="fixedlot__control"
              type="number"
              min={0.5}
              max={1440}
              step={0.5}
              value={minIntervalMinutes}
              onChange={(e) => {
                const v = Math.max(0.5, Math.min(1440, Number(e.target.value) || 10))
                setMinIntervalMinutes(v)
                if (v > maxIntervalMinutes) setMaxIntervalMinutes(v)
              }}
              title="Minutes between runs (random range lower bound)"
            />
          </div>
          <div className="fixedlot__field">
            <label htmlFor="fixedlot-max-int">Interval max</label>
            <input
              id="fixedlot-max-int"
              className="fixedlot__control"
              type="number"
              min={1}
              max={1440}
              step={0.5}
              value={maxIntervalMinutes}
              onChange={(e) => {
                const v = Math.max(1, Math.min(1440, Number(e.target.value) || 15))
                setMaxIntervalMinutes(v)
                if (v < minIntervalMinutes) setMinIntervalMinutes(v)
              }}
              title="Minutes — upper bound (min ≤ max, max 1440)"
            />
          </div>
        </div>
      </section>

      <section className="fixedlot__section" aria-labelledby="fixedlot-sym-title">
        <h3 id="fixedlot-sym-title" className="fixedlot__section-title">
          Instruments
        </h3>
        <p className="fixedlot__server-hint">
          Selection is saved on the <strong>panel server</strong> (shared with every browser that uses this API), not
          only in this browser.
        </p>
        <div className="symbol-checkbox-actions">
          <button type="button" onClick={selectAll}>
            Select all
          </button>
          <button type="button" onClick={clearAll}>
            Clear all
          </button>
          <button type="button" onClick={selectMajorUsd} disabled={symbols.length === 0}>
            Major USD
          </button>
          <button type="button" onClick={selectMajorM} disabled={symbols.length === 0}>
            Major (m)
          </button>
        </div>
        {loading && <p className="loading">Loading symbols…</p>}
        {!loading && symbols.length === 0 && (
          <p className="settings-hint">Choose an account above to load symbols.</p>
        )}
        {!loading && symbols.length > 0 && (
          <div className="symbol-checkbox-list">
            {symbols.map((s) => (
              <label key={s} className="symbol-checkbox-item">
                <input type="checkbox" checked={selectedSymbols.includes(s)} onChange={() => toggleSymbol(s)} />
                <span>{s}</span>
              </label>
            ))}
          </div>
        )}
        {selectedSymbols.length > 0 && (
          <p className="fixedlot__meta-line">
            {selectedSymbols.length} selected · volume range {minVolume}–{maxVolume} lots
          </p>
        )}
      </section>

      {selectedSymbols.length > 0 && (
        <section className="fixedlot__section" aria-labelledby="fixedlot-quotes-title">
          <div className="fixedlot__quotes-head">
            <h3 id="fixedlot-quotes-title" className="fixedlot__quotes-title">
              Live quotes
            </h3>
            <div className="fixedlot__quotes-meta">
              <span>{FIXED_ACCOUNTS.find((a) => a.id === accountId)?.label ?? accountId}</span>
              <span
                className={
                  quotesWsConnected ? 'fixedlot__status fixedlot__status--on' : 'fixedlot__status fixedlot__status--off'
                }
              >
                {quotesWsConnected ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 0 }}>
            <table className="slave-table fixedlot__quotes-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>Spread</th>
                </tr>
              </thead>
              <tbody>
                {[...selectedSymbols].sort().map((sym) => {
                  const t = liveTicks[sym]
                  const bid = t?.bid
                  const ask = t?.ask
                  const spread = bid != null && ask != null && ask >= bid ? ask - bid : undefined
                  const hasBid = bid != null && Number.isFinite(bid)
                  const hasAsk = ask != null && Number.isFinite(ask)
                  const hasSpread = spread != null && Number.isFinite(spread)
                  return (
                    <tr key={sym} className="fixedlot__quote-row">
                      <td className="fixedlot__quote-cell fixedlot__quote-cell--symbol">
                        <strong>{sym}</strong>
                      </td>
                      <td
                        className={
                          'fixedlot__quote-cell fixedlot__quote-cell--bid' +
                          (hasBid ? '' : ' muted')
                        }
                      >
                        {formatQuotePrice(sym, bid)}
                      </td>
                      <td
                        className={
                          'fixedlot__quote-cell fixedlot__quote-cell--ask' +
                          (hasAsk ? '' : ' muted')
                        }
                      >
                        {formatQuotePrice(sym, ask)}
                      </td>
                      <td
                        className={
                          'fixedlot__quote-cell fixedlot__quote-cell--spread' +
                          (hasSpread ? '' : ' muted')
                        }
                      >
                        {formatSpreadCell(sym, spread)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="fixedlot__actions">
        <button
          type="button"
          className="fixedlot__btn-primary"
          onClick={runNow}
          disabled={submitting || closingAll || pool.length === 0}
        >
          {submitting ? 'Placing…' : 'Run now'}
        </button>
        <button
          type="button"
          className="btn-danger fixedlot__btn-close-all"
          onClick={closeAllPositions}
          disabled={submitting || closingAll}
          title="Close every open position on the account selected above (same endpoint as Live Positions)."
        >
          {closingAll ? 'Closing…' : 'Close all positions'}
        </button>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={intervalEnabled}
            onChange={(e) => setIntervalEnabled(e.target.checked)}
          />
          <span>
            Auto interval ({minIntervalMinutes}–{maxIntervalMinutes} min)
          </span>
        </label>
        {intervalEnabled && pool.length > 0 && nextRunAt && (
          <span className="fixedlot__countdown">
            Next run <strong><NextRunCountdown nextRunAt={nextRunAt} /></strong>
          </span>
        )}
      </footer>

      {msg && (
        <p className={msg.type === 'success' ? 'msg success' : 'msg error'} role="status">
          {msg.text}
        </p>
      )}
      </div>
    </div>
  )
}
