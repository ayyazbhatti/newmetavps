/**
 * WebSocket base URL for the MT5 panel API.
 * In dev, use same host:port as Vite so `/ws/*` is proxied to the backend (avoids direct :3001 blocks).
 * In production, connect to API port on the same hostname.
 */
export function getPanelWsBase(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (import.meta.env.DEV) {
    return `${proto}//${window.location.host}`
  }
  return `${proto}//${window.location.hostname}:3001`
}
