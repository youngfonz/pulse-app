import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import { VALID_TASK_STATUSES } from '@/actions/board-validation'

export async function OPTIONS() { return handleCors() }

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth

    const body = await request.json()
    const { taskId, status, sortOrder } = body

    if (!taskId) return apiError('taskId is required', 400)
    if (!status || !VALID_TASK_STATUSES.includes(status)) return apiError('Invalid status', 400)
    if (typeof sortOrder !== 'number') return apiError('sortOrder is required', 400)

    let task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { projectId: true },
    })

    if (!task) {
      // Check shared project access (editor+)
      const found = await prisma.task.findFirst({
        where: { id: taskId },
        select: { projectId: true },
      })
      if (found?.projectId) {
        const access = await prisma.projectAccess.findUnique({
          where: { projectId_userId: { projectId: found.projectId, userId } },
          select: { role: true },
        })
        if (access && ['editor', 'manager'].includes(access.role)) {
          task = found
        }
      }
    }

    if (!task) return apiError('Task not found or insufficient permissions', 404)

    await prisma.task.update({
      where: { id: taskId },
      data: { status, sortOrder },
    })

    // Auto-update project status
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
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API v1/board PATCH error:', error)
    return apiError('Internal error', 500)
  }
}
