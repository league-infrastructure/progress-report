import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useLocation } from 'wouter'
import type { TemplateDto } from '../types/template'
import { Button } from '../components/ui/button'

export function TemplateEditorPage() {
  const { id } = useParams<{ id?: string }>()
  const isNew = !id || id === 'new'
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  // For edit mode, load existing templates from cache or fetch
  const { data: templates = [] } = useQuery<TemplateDto[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await fetch('/api/templates')
      if (!res.ok) throw new Error('Failed to load templates')
      return res.json()
    },
    enabled: !isNew,
  })

  useEffect(() => {
    if (!isNew && id) {
      const cached = templates.find((t) => t.id === parseInt(id, 10))
      if (cached) {
        setName(cached.name)
        setSubject(cached.subject)
        setBody(cached.body)
      }
    }
  }, [id, isNew, templates])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = isNew ? '/api/templates' : `/api/templates/${id}`
      const method = isNew ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subject, body }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to save template')
      }
      return res.json() as Promise<TemplateDto>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setLocation('/templates')
    },
  })

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-4">
        <button
          onClick={() => setLocation('/templates')}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Templates
        </button>
      </div>

      <h1 className="text-xl font-bold text-slate-800 mb-4">
        {isNew ? 'New Template' : 'Edit Template'}
      </h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
          <div className="text-xs text-slate-500 mb-2 space-y-1">
            <p className="font-medium text-slate-600">Data placeholders (filled automatically):</p>
            <p>
              <code className="bg-slate-100 px-1 rounded">{'{{studentName}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{guardianName}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{month}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{instructorName}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{attendanceSummary}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{githubSummary}}'}</code>
            </p>
            <p className="font-medium text-slate-600 mt-2">AI placeholders (filled by Claude when you click "Generate from GitHub"):</p>
            <p>
              <code className="bg-orange-50 border border-orange-200 px-1 rounded">{'{{progress}}'}</code>{' '}— what the student worked on
            </p>
            <p>
              <code className="bg-orange-50 border border-orange-200 px-1 rounded">{'{{highlights}}'}</code>{' '}— achievements and skills demonstrated
            </p>
            <p>
              <code className="bg-orange-50 border border-orange-200 px-1 rounded">{'{{instructorNotes}}'}</code>{' '}— instructor's plan and suggestions
            </p>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {saveMutation.isError && (
        <p className="mt-2 text-sm text-red-600">
          {(saveMutation.error as Error)?.message ?? 'Failed to save.'}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" onClick={() => setLocation('/templates')}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
