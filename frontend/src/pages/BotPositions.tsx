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

type AccountPositions = {
  account_id: string
  label: string
  positions: Position[]
}

type Props = {
  allPositions: AccountPositions[]
  onRefresh: () => void
}

export default function BotPositions({ allPositions, onRefresh }: Props) {
  const totalCount = allPositions.reduce((n, a) => n + a.positions.length, 0)

  return (
    <>
      <div className="card">
        <h2>Open positions (both accounts)</h2>
        <button type="button" onClick={onRefresh} style={{ marginBottom: '0.75rem' }}>
          Refresh
        </button>
        {totalCount === 0 ? (
          <p className="empty">No open positions on any account.</p>
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Volume</th>
                  <th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {allPositions.flatMap(({ account_id, label, positions }) =>
                  positions.map((p) => (
                    <tr key={`${account_id}-${p.ticket}`}>
                      <td>{label}</td>
                      <td>{p.symbol}</td>
                      <td><span className={p.type}>{p.type}</span></td>
                      <td>{p.volume}</td>
                      <td className={p.profit >= 0 ? 'profit' : 'loss'}>
                        {(p.profit >= 0 ? '+' : '') + p.profit.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
