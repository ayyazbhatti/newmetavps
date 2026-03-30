import { useState, useEffect } from 'react'
import type { FailedPositionRecord, WorkerPlaceMode } from '../App'

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'any moment'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min > 0) return `${min} min ${sec} sec`
  return `${sec} sec`
}

function WorkerCountdown({ nextRunAt }: { nextRunAt: Date }) {
  const [label, setLabel] = useState(() => formatCountdown(nextRunAt.getTime() - Date.now()))
  useEffect(() => {
    const tick = () => setLabel(formatCountdown(nextRunAt.getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextRunAt])
  return <>{label}</>
}

type Account = { id: string; label: string }

type Props = {
  accounts: Account[]
  useSlTp: boolean
  setUseSlTp: (v: boolean) => void
  slTpPipsByAccount: Record<string, { sl_pips: number; tp_pips: number }>
  setSlTpPips: (accountId: string, sl_pips: number, tp_pips: number) => void
  workerEnabled: boolean
  setWorkerEnabled: (v: boolean) => void
  workerFixedInterval: boolean
  setWorkerFixedInterval: (v: boolean) => void
  workerIntervalMinutes: number
  setWorkerIntervalMinutes: (v: number) => void
  workerMinMinutes: number
  setWorkerMinMinutes: (v: number) => void
  workerMaxMinutes: number
  setWorkerMaxMinutes: (v: number) => void
  workerSymbols: string[]
  setWorkerSymbols: (v: string[]) => void
  workerMinVolume: number
  setWorkerMinVolume: (v: number) => void
  workerMaxVolume: number
  setWorkerMaxVolume: (v: number) => void
  workerPlaceMode: WorkerPlaceMode
  setWorkerPlaceMode: (v: WorkerPlaceMode) => void
  workerMaxOpenPositions: number
  setWorkerMaxOpenPositions: (v: number) => void
  workerLastRun: Date | null
  workerNextRunAt: Date | null
  workerRunCount: number
  onResetWorkerCounter: () => void
  workerFailedPositions: FailedPositionRecord[]
  onClearFailedPositions: () => void
  onResetWorkerBalance: () => void
  onRunNow?: () => void | Promise<void>
  symbols: string[]
}

export default function BotSettings(props: Props) {
  const {
    accounts,
    useSlTp,
    setUseSlTp,
    slTpPipsByAccount,
    setSlTpPips,
    workerEnabled,
    setWorkerEnabled,
    workerFixedInterval,
    setWorkerFixedInterval,
    workerIntervalMinutes,
    setWorkerIntervalMinutes,
    workerMinMinutes,
    setWorkerMinMinutes,
    workerMaxMinutes,
    setWorkerMaxMinutes,
    workerSymbols,
    setWorkerSymbols,
    workerMinVolume,
    setWorkerMinVolume,
    workerMaxVolume,
    setWorkerMaxVolume,
    workerPlaceMode,
    setWorkerPlaceMode,
    workerMaxOpenPositions,
    setWorkerMaxOpenPositions,
    workerLastRun,
    workerNextRunAt,
    workerRunCount,
    onResetWorkerCounter,
    workerFailedPositions,
    onClearFailedPositions,
    onResetWorkerBalance,
    onRunNow,
    symbols,
  } = props

  const toggleSymbol = (s: string) => {
    if (workerSymbols.includes(s)) {
      setWorkerSymbols(workerSymbols.filter((x) => x !== s))
    } else {
      setWorkerSymbols([...workerSymbols, s].sort())
    }
  }

  const selectAll = () => setWorkerSymbols([...symbols].sort())
  const clearAll = () => setWorkerSymbols([])

  return (
    <div className="settings-page">
      <div className="card">
        <h2>SL/TP per account (pips)</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="checkbox"
            checked={useSlTp}
            onChange={(e) => setUseSlTp(e.target.checked)}
          />
          Set SL/TP when opening positions (manual and worker)
        </label>
        <p className="settings-desc">
          When enabled, Stop Loss and Take Profit in pips are applied per account. E.g. Exness 3:1 = TP 30, SL 10; IC Markets 1:3 = TP 10, SL 30.
        </p>
        {accounts.length === 0 ? (
          <p className="settings-hint">Load accounts first (open Bot Trading or refresh).</p>
        ) : (
          accounts.map((a) => {
            const pips = slTpPipsByAccount[a.id] ?? { sl_pips: 10, tp_pips: 30 }
            return (
              <div key={a.id} className="row" style={{ marginBottom: '1rem' }}>
                <div style={{ minWidth: '8rem' }}>
                  <label>{a.label}</label>
                  <div className="settings-hint" style={{ marginTop: 0 }}>SL / TP (pips)</div>
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={pips.sl_pips}
                    onChange={(e) => setSlTpPips(a.id, Math.max(0, Number(e.target.value) || 0), pips.tp_pips)}
                  />
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={pips.tp_pips}
                    onChange={(e) => setSlTpPips(a.id, pips.sl_pips, Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="card card-bot-worker">
        <h2>Bot worker</h2>
        <p className="worker-intro">
          The worker opens positions at a random interval. Choose how it places orders, then turn it on.
        </p>

        <div className="worker-block">
          <span className="worker-block-label">Place mode</span>
          <div className="worker-place-options">
            <label className={`worker-place-option ${workerPlaceMode === 'both' ? 'worker-place-option--active' : ''}`}>
              <input
                type="radio"
                name="workerPlaceMode"
                checked={workerPlaceMode === 'both'}
                onChange={() => setWorkerPlaceMode('both')}
              />
              <span className="worker-place-title">Both accounts</span>
              <span className="worker-place-desc">One Buy on one account, one Sell on the other (two accounts only)</span>
            </label>
            <label className={`worker-place-option ${workerPlaceMode === 'master_slave_hedge' ? 'worker-place-option--active' : ''}`}>
              <input
                type="radio"
                name="workerPlaceMode"
                checked={workerPlaceMode === 'master_slave_hedge'}
                onChange={() => setWorkerPlaceMode('master_slave_hedge')}
              />
              <span className="worker-place-title">Broker B + Exness (copy hedge)</span>
              <span className="worker-place-desc">Broker B: full volume; Exness: volume ÷ N (N = Exness copy accounts)</span>
            </label>
          </div>
          <p className="worker-block-hint">
            {workerPlaceMode === 'master_slave_hedge'
              ? 'Broker B: full volume. Exness: volume ÷ N (set N in Exness copy hedge).'
              : 'One random symbol per run, random volume between min and max (same for both).'}
          </p>
        </div>

        <div className="worker-toggle-block">
          <label className="worker-toggle-label">
            <input
              type="checkbox"
              checked={workerEnabled}
              onChange={(e) => setWorkerEnabled(e.target.checked)}
            />
            <span className="worker-toggle-text">Enable bot worker</span>
          </label>
          <p className="worker-toggle-hint">When enabled, the worker runs in the background and places trades at the interval below.</p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input
            type="checkbox"
            checked={workerFixedInterval}
            onChange={(e) => setWorkerFixedInterval(e.target.checked)}
          />
          Fixed interval (run every N minutes)
        </label>
        {workerFixedInterval ? (
          <div className="row">
            <div>
              <label>Interval (minutes)</label>
              <input
                type="number"
                min={0.5}
                max={1440}
                step={0.5}
                value={workerIntervalMinutes}
                onChange={(e) => setWorkerIntervalMinutes(Math.max(0.5, Math.min(1440, Number(e.target.value) || 15)))}
              />
            </div>
          </div>
        ) : (
          <div className="row">
            <div>
              <label>Min interval (minutes)</label>
              <input
                type="number"
                min={0.5}
                max={1440}
                step={0.5}
                value={workerMinMinutes}
                onChange={(e) => {
                  const v = Math.max(0.5, Math.min(1440, Number(e.target.value) || 1))
                  setWorkerMinMinutes(v)
                  if (v > workerMaxMinutes) setWorkerMaxMinutes(v)
                }}
              />
            </div>
            <div>
              <label>Max interval (minutes)</label>
              <input
                type="number"
                min={1}
                max={1440}
                step={0.5}
                value={workerMaxMinutes}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(1440, Number(e.target.value) || 5))
                  setWorkerMaxMinutes(v)
                  if (v < workerMinMinutes) setWorkerMinMinutes(v)
                }}
              />
            </div>
          </div>
        )}
        <p className="settings-hint" style={{ marginTop: 0 }}>
          {workerFixedInterval ? 'Worker runs every N minutes (e.g. 15 = every 15 min).' : 'Min must be ≤ Max. Capped at 1440 min (24h).'}
        </p>

        <label>Symbols (pick one per run at random)</label>
        <div className="symbol-checkbox-actions">
          <button type="button" onClick={selectAll}>Select all</button>
          <button type="button" onClick={clearAll}>Clear all</button>
        </div>
        <div className="symbol-checkbox-list">
          {symbols.length === 0 ? (
            <p className="settings-hint">Load symbols on Bot Trading first, then come back here.</p>
          ) : (
            symbols.map((s) => (
              <label key={s} className="symbol-checkbox-item">
                <input
                  type="checkbox"
                  checked={workerSymbols.includes(s)}
                  onChange={() => toggleSymbol(s)}
                />
                <span>{s}</span>
              </label>
            ))
          )}
        </div>
        {workerSymbols.length > 0 && (
          <p className="settings-hint">{workerSymbols.length} symbol(s) selected. Worker picks one at random per run and never repeats the same symbol on consecutive runs.</p>
        )}

        <div className="row">
          <div>
            <label>Min volume (lots)</label>
            <input
              type="number"
              step="0.0001"
              min="0.0001"
              value={workerMinVolume}
              onChange={(e) => setWorkerMinVolume(Math.max(0.0001, Number(e.target.value) || 0.0001))}
            />
          </div>
          <div>
            <label>Max volume (lots)</label>
            <input
              type="number"
              step="0.0001"
              min="0.0001"
              value={workerMaxVolume}
              onChange={(e) => setWorkerMaxVolume(Math.max(0.0001, Number(e.target.value) || 0.0001))}
            />
          </div>
        </div>
        <p className="settings-hint">
          {workerPlaceMode === 'master_slave_hedge'
            ? 'Broker B volume must be ≥ N×0.01 (see Exness copy hedge). Worker picks random between min and max (both are raised to that minimum). Set different min and max (e.g. 0.1 and 0.2) for random volume.'
            : 'Worker picks a random volume between min and max per run (same for both positions). Set different min and max for random; same min = max = fixed volume.'}
        </p>

        <div className="row" style={{ marginTop: '1rem', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label htmlFor="worker-max-open-positions">Max open positions</label>
          <input
            id="worker-max-open-positions"
            type="number"
            min={0}
            step={1}
            value={workerMaxOpenPositions}
            onChange={(e) => setWorkerMaxOpenPositions(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            style={{ width: '5rem' }}
            title="0 = no limit. Worker stops opening when total open positions (both accounts) reach this number; resumes when count drops below."
          />
          <span className="settings-hint" style={{ marginTop: 0 }}>0 = no limit. Worker stops when open count reaches this; resumes when positions are closed.</span>
        </div>

        <div className="row" style={{ marginTop: '1rem', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="settings-status">
            Worker runs: <strong>{workerRunCount}</strong>
          </span>
          <button type="button" onClick={onResetWorkerCounter}>
            Reset counter
          </button>
          <button type="button" onClick={onResetWorkerBalance}>
            Reset worker balance
          </button>
        </div>
        <p className="settings-hint" style={{ marginTop: '0.25rem' }}>
          Reset worker balance when you switch to new accounts so Buy/Sell assignment starts 50/50 again.
        </p>

        {workerEnabled && (
          <>
            <p className="settings-status">
              Worker is running.
              {workerNextRunAt ? (
                <span className="worker-countdown"> Next run in <strong><WorkerCountdown nextRunAt={workerNextRunAt} /></strong></span>
              ) : (
                <> Next run in {workerFixedInterval ? `${workerIntervalMinutes} min` : `${workerMinMinutes}–${workerMaxMinutes} min (random)`}.</>
              )}
              {onRunNow && (
                <button type="button" onClick={onRunNow} style={{ marginLeft: '0.75rem' }}>
                  Run now
                </button>
              )}
            </p>
            {workerLastRun && (
              <p className="settings-last-run">
                Last run: {workerLastRun.toLocaleTimeString()}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Failed positions (one-sided, closed by worker)</h2>
        <p className="settings-desc">
          When the worker opens on only some accounts (e.g. one leg fails), the opened position(s) are closed immediately to avoid unhedged exposure. Those events are listed below.
        </p>
        {workerFailedPositions.length === 0 ? (
          <p className="settings-hint">No failed one-sided positions recorded.</p>
        ) : (
          <>
            <div style={{ marginBottom: '0.5rem' }}>
              <button type="button" onClick={onClearFailedPositions}>
                Clear list
              </button>
            </div>
            <ul className="failed-positions-list" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '12rem', overflowY: 'auto' }}>
              {workerFailedPositions.map((fp, i) => (
                <li key={`${fp.time}-${i}`} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border, #333)' }}>
                  <span style={{ opacity: 0.8 }}>{new Date(fp.time).toLocaleString()}</span>
                  {' — '}
                  <strong>{fp.symbol}</strong> {fp.volume} lots
                  {fp.message && <div className="settings-hint" style={{ marginTop: '0.2rem' }}>{fp.message}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
