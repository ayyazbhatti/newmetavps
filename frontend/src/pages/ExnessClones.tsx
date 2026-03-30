import { useCallback, useEffect, useState } from 'react'

const API = '/api'

type CloneStatus = {
  clones_root?: string
  template_dir?: string
  existing_folders?: string[]
  existing_count?: number
}

export default function ExnessClones() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [targetCount, setTargetCount] = useState('5')
  const [status, setStatus] = useState<CloneStatus>({})
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/exness-clones`)
      const data = await r.json().catch(() => ({}))
      if (r.ok && data?.ok) {
        setStatus({
          clones_root: data.clones_root,
          template_dir: data.template_dir,
          existing_folders: Array.isArray(data.existing_folders) ? data.existing_folders : [],
          existing_count: Number(data.existing_count) || 0,
        })
      }
    } catch {
      // Ignore transient request errors; user can retry.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const n = Math.floor(Number(targetCount))
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      setMsg({ type: 'error', text: 'Enter a number between 1 and 200.' })
      return
    }
    setSaving(true)
    try {
      const r = await fetch(`${API}/exness-clones/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_count: n }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data?.ok) {
        setMsg({ type: 'error', text: data?.error ?? 'Failed to create clones.' })
        return
      }
      setStatus({
        clones_root: data.clones_root,
        template_dir: status.template_dir,
        existing_folders: Array.isArray(data.existing_folders) ? data.existing_folders : [],
        existing_count: Number(data.existing_count) || 0,
      })
      const created = Array.isArray(data.created_folders) ? data.created_folders.length : 0
      setMsg({
        type: 'success',
        text: created > 0 ? `Created ${created} new terminal clone(s).` : 'All requested clone folders already exist.',
      })
    } catch {
      setMsg({ type: 'error', text: 'Request failed.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h2>Exness terminal clones</h2>
      <p className="settings-desc">
        Set how many Exness terminal folders you want in <code>MT5_Exness_Clones</code>. The panel creates
        missing folders as <code>Exness_01</code>, <code>Exness_02</code>, and so on.
      </p>
      {msg && (
        <div className={`msg ${msg.type}`} role="alert">
          {msg.text}
        </div>
      )}
      <form onSubmit={handleCreate}>
        <div className="form-row">
          <label htmlFor="target-count">Total clone folders to keep</label>
          <input
            id="target-count"
            type="number"
            min={1}
            max={200}
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value)}
            disabled={saving}
          />
        </div>
        <button type="submit" disabled={saving || loading}>
          {saving ? 'Creating...' : 'Create missing clones'}
        </button>
        <button
          type="button"
          style={{ marginLeft: '0.75rem' }}
          onClick={() => void loadStatus()}
          disabled={saving}
        >
          Refresh
        </button>
      </form>

      {loading ? (
        <p className="loading" style={{ marginTop: '1rem' }}>Loading current clone status...</p>
      ) : (
        <>
          <p className="settings-status" style={{ marginTop: '1rem' }}>
            Existing clone folders: <strong>{status.existing_count ?? 0}</strong>
          </p>
          <p className="settings-hint">
            Clones folder: <code>{status.clones_root ?? 'N/A'}</code>
          </p>
          <p className="settings-hint">
            Template used: <code>{status.template_dir ?? 'N/A'}</code>
          </p>
          <div className="form-row">
            <label>Detected folders</label>
            <textarea
              readOnly
              rows={8}
              value={(status.existing_folders ?? []).join('\n') || 'No Exness clones found yet.'}
            />
          </div>
        </>
      )}
    </div>
  )
}
