'use server'

import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { VALID_TASK_STATUSES } from './board-validation'

export async function updateTaskStatus(
  taskId: string,
  status: string,
  sortOrder: number
) {
  if (!VALID_TASK_STATUSES.includes(status)) {
    throw new Error('Invalid status')
  }
  const userId = await requireUserId()
  let task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    select: { projectId: true },
  })

  if (!task) {
    const { requireProjectAccess } = await import('@/lib/access')
    const found = await prisma.task.findFirst({
      where: { id: taskId },
      select: { projectId: true },
    })
    if (!found) return
    if (!found.projectId) throw new Error('Not authorized')
    await requireProjectAccess(found.projectId, 'editor')
    task = found
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      sortOrder,
    },
  })

  // Auto-update project status based on task completion (excludes bookmarks)
  if (task.projectId) {
    const projectTasks = await prisma.task.findMany({
      where: { projectId: task.projectId, url: null },
      select: { status: true },
    })
    const allCompleted = projectTasks.length > 0 && projectTasks.every(t => t.status === 'done')
    const project = await prisma.project.findFirst({
      where: { id: task.projectId },
      select: { status: true },
    })

    if (allCompleted && project?.status !== 'completed') {
      await prisma.project.update({
        where: { id: task.projectId },
        data: { status: 'completed' },
      })
    } else if (!allCompleted && project?.status === 'completed') {
      await prisma.project.update({
        where: { id: task.projectId },
        data: { status: 'in_progress' },
      })
    }

    revalidatePath(`/projects/${task.projectId}`)
  }
  revalidatePath('/tasks')
  revalidatePath('/projects')
}
