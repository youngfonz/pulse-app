import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import {
  VALID_PRIORITIES,
  MAX_TITLE_LENGTH,
  MAX_TEXT_LENGTH,
} from '@/actions/tasks-validation'

export async function OPTIONS() { return handleCors() }

async function getEditableProject(projectId: string, userId: string) {
  const owned = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, userId: true },
  })
  if (owned) return owned

  const access = await prisma.projectAccess.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true, project: { select: { id: true, userId: true } } },
  })

  if (access && ['editor', 'manager'].includes(access.role)) {
    return access.project
  }

  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth
    const { id } = await params

    const include = {
      images: true,
      files: true,
      comments: { orderBy: { createdAt: 'desc' as const } },
      project: { select: { id: true, name: true } },
    }

    let task = await prisma.task.findFirst({ where: { id, userId }, include })

    if (!task) {
      // Check shared project access
      const sharedAccess = await prisma.projectAccess.findMany({
        where: { userId },
        select: { projectId: true },
      })
      const sharedIds = sharedAccess.map(r => r.projectId)
      if (sharedIds.length > 0) {
        task = await prisma.task.findFirst({
          where: { id, projectId: { in: sharedIds } },
          include,
        })
      }
    }

    if (!task) return apiError('Task not found', 404)
    return NextResponse.json(task)
  } catch (error) {
    console.error('API v1/tasks/[id] GET error:', error)
    return apiError('Internal error', 500)
  }
}

export async function PATCH(
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
      select: { projectId: true, url: true, userId: true },
    })

    if (!task) {
      // Check shared project access (editor+)
      const found = await prisma.task.findFirst({
        where: { id },
        select: { projectId: true, url: true, userId: true },
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

    const body = await request.json()

    const data: Record<string, unknown> = {}

    if (body.title !== undefined) {
      const title = (body.title || '').slice(0, MAX_TITLE_LENGTH)
      if (!title.trim()) return apiError('Title is required', 400)
      data.title = title
    }

    if (body.description !== undefined) {
      data.description = (body.description || '').slice(0, MAX_TEXT_LENGTH) || null
    }

    if (body.notes !== undefined) {
      data.notes = (body.notes || '').slice(0, MAX_TEXT_LENGTH) || null
    }

    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(body.priority)) return apiError('Invalid priority', 400)
      data.priority = body.priority
    }

    if (body.status !== undefined) {
      const validStatuses = ['todo', 'in_progress', 'done']
      if (!validStatuses.includes(body.status)) return apiError('Invalid status', 400)
      data.status = body.status
    }

    if (body.projectId !== undefined) {
      const nextProjectId = body.projectId === 'none' || body.projectId === null ? null : body.projectId
      if (nextProjectId !== null && typeof nextProjectId !== 'string') {
        return apiError('Invalid projectId', 400)
      }

      if (nextProjectId !== task.projectId) {
        if (!nextProjectId) {
          if (task.userId !== userId) {
            return apiError('Not authorized to remove shared task from its project', 403)
          }
        } else {
          const destination = await getEditableProject(nextProjectId, userId)
          if (!destination) return apiError('Destination project not found or insufficient permissions', 404)
          data.userId = destination.userId
        }
      }

      data.projectId = nextProjectId
    }

    if (body.startDate !== undefined) {
      data.startDate = body.startDate ? new Date(body.startDate) : null
    }

    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null
    }

    // Bookmark-specific fields
    if (task.url) {
      if (body.tags !== undefined && Array.isArray(body.tags)) {
        data.tags = body.tags.filter((t: unknown) => typeof t === 'string' && (t as string).length <= 50).slice(0, 20)
      }
      if (body.thumbnailUrl !== undefined) {
        data.thumbnailUrl = body.thumbnailUrl || null
      }
    }

    const updated = await prisma.task.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('API v1/tasks/[id] PATCH error:', error)
    return apiError('Internal error', 500)
  }
}

export async function DELETE(
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
      select: { projectId: true },
    })

    if (!task) {
      // Check shared project access (editor+)
      const found = await prisma.task.findFirst({
        where: { id },
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

    await prisma.task.delete({ where: { id } })

    // Auto-update project status
    if (task.projectId) {
      const remaining = await prisma.task.findMany({
        where: { projectId: task.projectId, url: null },
        select: { status: true },
      })
      const allCompleted = remaining.length > 0 && remaining.every(t => t.status === 'done')
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
    console.error('API v1/tasks/[id] DELETE error:', error)
    return apiError('Internal error', 500)
  }
}
