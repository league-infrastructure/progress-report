import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearch } from 'wouter'
import { MonthPicker } from '../components/MonthPicker'
import { getDefaultMonth } from '../lib/utils'
import type { ComplianceRow } from '../types/admin'

interface ComplianceResponse {
  month: string
  rows: ComplianceRow[]
}

async function fetchCompliance(month: string): Promise<ComplianceResponse> {
  const res = await fetch(`/api/admin/compliance?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load compliance data')
  return res.json()
}

type SortKey = 'name' | 'pending' | 'draft' | 'sent' | 'recentCheckinSubmitted'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 text-slate-300">↕</span>
  return <span className="ml-1 text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

export function CompliancePage() {
  const search = useSearch()
  const params = new URLSearchParams(search)
  const month = params.get('month') ?? getDefaultMonth()

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data, isLoading, error } = useQuery<ComplianceResponse>({
    queryKey: ['admin', 'compliance', month],
    queryFn: () => fetchCompliance(month),
  })

  const rows = data?.rows ?? []

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'pending') cmp = a.pending - b.pending
      else if (sortKey === 'draft') cmp = a.draft - b.draft
      else if (sortKey === 'sent') cmp = a.sent - b.sent
      else if (sortKey === 'recentCheckinSubmitted') cmp = Number(a.recentCheckinSubmitted) - Number(b.recentCheckinSubmitted)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const thClass = 'cursor-pointer select-none px-4 py-3 text-left font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Compliance</h1>
        <MonthPicker />
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load compliance data.</p>}

      {!isLoading && rows.length === 0 && (
        <p className="text-slate-500">No active instructors found.</p>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={thClass} onClick={() => handleSort('name')}>
                  Instructor <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('pending')}>
                  Pending <SortIcon col="pending" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('draft')}>
                  Draft <SortIcon col="draft" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('sent')}>
                  Sent <SortIcon col="sent" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('recentCheckinSubmitted')}>
                  Check-in <SortIcon col="recentCheckinSubmitted" sortKey={sortKey} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((row) => (
                <tr key={row.instructorId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
                  <td className="px-4 py-3 text-slate-700">{row.pending}</td>
                  <td className="px-4 py-3 text-slate-700">{row.draft}</td>
                  <td className="px-4 py-3 text-slate-700">{row.sent}</td>
                  <td className="px-4 py-3">
                    {row.recentCheckinSubmitted ? (
                      <span className="text-green-600" title="Submitted">✓</span>
                    ) : (
                      <span className="text-red-500" title="Not submitted">✗</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
