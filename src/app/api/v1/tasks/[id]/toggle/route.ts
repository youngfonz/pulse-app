import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'

export async function OPTIONS() { return handleCors() }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth
    const { id } = await params

    let task = await prisma.task.findFirst({
      where: { id, userId },
      select: { status: true, projectId: true },
    })

    if (!task) {
      // Check shared project access (editor+)
      const found = await prisma.task.findFirst({
        where: { id },
        select: { status: true, projectId: true },
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

    const newStatus = task.status === 'done' ? 'todo' : 'done'
    const updated = await prisma.task.update({
      where: { id },
      data: { status: newStatus },
    })

    // Auto-update project status based on task completion
    if (task.projectId) {
      const realTasks = await prisma.task.findMany({
        where: { projectId: task.projectId, url: null },
        select: { status: true },
      })
      const allCompleted = realTasks.length > 0 && realTasks.every(t => t.status === 'done')
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

    return NextResponse.json(updated)
  } catch (error) {
    console.error('API v1/tasks/[id]/toggle error:', error)
    return apiError('Internal error', 500)
  }
}
