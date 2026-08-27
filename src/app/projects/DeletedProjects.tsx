'use client'

import { useState, useTransition } from 'react'
import { restoreProject, permanentDeleteProject } from '@/actions/projects'
import { formatDate } from '@/lib/utils'

interface DeletedProject {
  id: string
  name: string
  deletedAt: Date | null
  client: { id: string; name: string }
  _count: { tasks: number }
}

export function DeletedProjects({ projects }: { projects: DeletedProject[] }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (projects.length === 0) return null

  function handleRestore(id: string) {
    if (!confirm('Restore this project and all its tasks?')) return
    setError(null)
    startTransition(async () => {
      const result = await restoreProject(id)
      if (result?.error) setError(result.error)
    })
  }

  function handlePermanentDelete(id: string) {
    if (!confirm('Permanently delete this project? This cannot be undone.')) return
    startTransition(() => permanentDeleteProject(id))
  }

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
        Recently Deleted ({projects.length})
      </button>

      {open && error && (
        <p className="mt-3 rounded-lg bg-[#E54D2E]/10 px-4 py-3 text-sm text-[#E54D2E] dark:text-[#F0613E]">
          {error}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground truncate">
                  {project.name}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {project.client.name} &middot; {project._count.tasks} tasks &middot; Deleted {formatDate(project.deletedAt!)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleRestore(project.id)}
                  disabled={pending}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Restore
                </button>
                <button
                  onClick={() => handlePermanentDelete(project.id)}
                  disabled={pending}
                  className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                >
                  Delete Forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
