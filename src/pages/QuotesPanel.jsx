// Pure presentational now — quotes come from useOrgData (fetched once at
// login and kept live via Realtime), not its own fetch.
export default function QuotesPanel({ quotes }) {
  if (quotes.length === 0) return <p className="panel-muted">No quotes yet.</p>

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Company</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>Message</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map(q => (
            <tr key={q.id}>
              <td>{q.name || '—'}</td>
              <td className="tabular">{q.phone}</td>
              <td>{q.company || '—'}</td>
              <td>{q.product || '—'}</td>
              <td>{q.quantity || '—'}</td>
              <td className="truncate-cell">{q.message || '—'}</td>
              <td className="panel-muted">{new Date(q.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
