import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface TrainingType {
  id: number
  name: string
  description: string | null
}
interface TrainingRecord {
  trainingTypeId: number
  met: boolean
  driveUrl: string | null
  expiresAt: string | null
  notes: string | null
  updatedAt?: string | null
}
interface StaffRow {
  id: number
  name: string
  email: string | null
  kind: string
  active: boolean
  records: TrainingRecord[]
}
interface TrainingsResponse {
  trainings: TrainingType[]
  staff: StaffRow[]
}

async function fetchTrainings(): Promise<TrainingsResponse> {
  const res = await fetch('/api/admin/trainings')
  if (!res.ok) throw new Error('Failed to load trainings')
  return res.json()
}

const RENEWAL_WINDOW_DAYS = 30
const STALE_MONTHS = 12

function cellStatus(rec: TrainingRecord | undefined): 'ok' | 'not_met' | 'expiring' | 'expired' | 'stale' {
  if (!rec || !rec.met) return 'not_met'
  const now = Date.now()
  if (rec.expiresAt) {
    const exp = new Date(rec.expiresAt).getTime()
    if (exp < now) return 'expired'
    if (exp <= now + RENEWAL_WINDOW_DAYS * 864e5) return 'expiring'
    return 'ok'
  }
  // met but no expiry date — flag for review once it's been stale a long time
  if (rec.updatedAt) {
    const staleBefore = new Date()
    staleBefore.setMonth(staleBefore.getMonth() - STALE_MONTHS)
    if (new Date(rec.updatedAt).getTime() < staleBefore.getTime()) return 'stale'
  }
  return 'ok'
}

export function TrainingsPage() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery<TrainingsResponse>({
    queryKey: ['admin', 'trainings'],
    queryFn: fetchTrainings,
  })
  const [checkMsg, setCheckMsg] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const saveMutation = useMutation({
    mutationFn: async (p: { staffId: number; trainingTypeId: number; rec: Partial<TrainingRecord> & { met: boolean } }) => {
      const res = await fetch(`/api/admin/trainings/${p.staffId}/${p.trainingTypeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.rec),
      })
      if (!res.ok) throw new Error('Save failed')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'trainings'] }),
  })

  async function runCheck() {
    setChecking(true); setCheckMsg(null)
    try {
      const res = await fetch('/api/admin/trainings/check', { method: 'POST' })
      const d = (await res.json()) as { alertCount: number; notified: boolean; emailed: boolean }
      setCheckMsg(
        d.alertCount === 0
          ? 'All staff trainings are current — nothing to notify.'
          : `${d.alertCount} item(s) flagged. Notification created${d.emailed ? ' and email sent' : ''}.`,
      )
    } catch {
      setCheckMsg('Check failed.')
    } finally {
      setChecking(false)
    }
  }

  const trainings = data?.trainings ?? []
  const staff = data?.staff ?? []

  function recFor(row: StaffRow, tId: number): TrainingRecord | undefined {
    return row.records.find((r) => r.trainingTypeId === tId)
  }

  function save(row: StaffRow, t: TrainingType, patch: Partial<TrainingRecord>) {
    const cur = recFor(row, t.id)
    saveMutation.mutate({
      staffId: row.id,
      trainingTypeId: t.id,
      rec: {
        met: patch.met ?? cur?.met ?? false,
        driveUrl: patch.driveUrl ?? cur?.driveUrl ?? null,
        expiresAt: patch.expiresAt ?? cur?.expiresAt ?? null,
        notes: patch.notes ?? cur?.notes ?? null,
      },
    })
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Staff Trainings</h1>
          <p className="text-sm text-slate-500">
            AB 506 and other required trainings for instructors &amp; volunteers. Flags anything unmet or expiring within {RENEWAL_WINDOW_DAYS} days.
          </p>
        </div>
        <button
          onClick={runCheck}
          disabled={checking}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Run check & notify'}
        </button>
      </div>

      {checkMsg && <p className="mb-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{checkMsg}</p>}
      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load trainings.</p>}
      {!isLoading && staff.length === 0 && (
        <p className="text-slate-500">No staff found. Staff sync from Pike13 — run a sync, then refresh.</p>
      )}

      {staff.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Staff</th>
                {trainings.map((t) => (
                  <th key={t.id} className="px-4 py-3 text-left font-medium text-slate-600" title={t.description ?? ''}>
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((row) => (
                <tr key={row.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{row.name}</div>
                    <div className="text-xs capitalize text-slate-400">{row.kind}</div>
                  </td>
                  {trainings.map((t) => {
                    const rec = recFor(row, t.id)
                    const status = cellStatus(rec)
                    const flag =
                      status === 'expired' ? 'border-red-300 bg-red-50'
                      : status === 'expiring' || status === 'stale' ? 'border-amber-300 bg-amber-50'
                      : status === 'not_met' ? 'border-slate-200'
                      : 'border-green-200 bg-green-50'
                    return (
                      <td key={t.id} className={`px-3 py-2`}>
                        <div className={`rounded border ${flag} p-2 space-y-1`}>
                          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                            <input
                              type="checkbox"
                              checked={rec?.met ?? false}
                              onChange={(e) => save(row, t, { met: e.target.checked })}
                            />
                            {rec?.met ? 'Met' : 'Not met'}
                            {status === 'expiring' && <span className="text-amber-700">· expiring</span>}
                            {status === 'expired' && <span className="text-red-700">· expired</span>}
                            {status === 'stale' && <span className="text-amber-700">· review</span>}
                          </label>
                          <input
                            type="date"
                            value={rec?.expiresAt ? new Date(rec.expiresAt).toISOString().slice(0, 10) : ''}
                            onChange={(e) => save(row, t, { expiresAt: e.target.value || null })}
                            className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                            title="Expiry / renewal date"
                          />
                          <input
                            type="url"
                            placeholder="Drive folder link"
                            defaultValue={rec?.driveUrl ?? ''}
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              if (v !== (rec?.driveUrl ?? '')) save(row, t, { driveUrl: v || null })
                            }}
                            className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                          />
                          {rec?.driveUrl && (
                            <a href={rec.driveUrl} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 underline">
                              Open folder ↗
                            </a>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
