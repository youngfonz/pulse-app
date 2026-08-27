import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import {
  VALID_PROJECT_STATUSES,
  VALID_PRIORITIES,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from '@/actions/projects-validation'

export async function OPTIONS() { return handleCors() }

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
      client: { select: { id: true, name: true } },
      images: true,
      tasks: {
        include: {
          images: true,
          files: true,
          _count: { select: { comments: true } },
        },
        orderBy: [
          { status: 'desc' as const },
          { priority: 'desc' as const },
          { createdAt: 'desc' as const },
        ],
      },
      timeEntries: {
        orderBy: { date: 'desc' as const },
      },
    }

    let project = await prisma.project.findFirst({
      where: { id, userId },
      include,
    })

    if (!project) {
      // Check shared project access
      const access = await prisma.projectAccess.findUnique({
        where: { projectId_userId: { projectId: id, userId } },
      })
      if (access) {
        project = await prisma.project.findFirst({ where: { id }, include })
      }
    }

    if (!project) return apiError('Project not found', 404)
    return NextResponse.json(project)
  } catch (error) {
    console.error('API v1/projects/[id] GET error:', error)
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

    // Check ownership or manager access
    let existing = await prisma.project.findFirst({ where: { id, userId } })
    if (!existing) {
      const access = await prisma.projectAccess.findUnique({
        where: { projectId_userId: { projectId: id, userId } },
        select: { role: true },
      })
      if (!access || !['manager'].includes(access.role)) {
        return apiError('Project not found or insufficient permissions', 404)
      }
      existing = await prisma.project.findFirst({ where: { id } })
    }
    if (!existing) return apiError('Project not found', 404)

    const body = await request.json()

    const name = (body.name || existing.name).slice(0, MAX_NAME_LENGTH)
    if (!name.trim()) return apiError('Name is required', 400)

    const status = body.status || existing.status
    if (!VALID_PROJECT_STATUSES.includes(status)) return apiError('Invalid status', 400)

    const priority = body.priority || existing.priority
    if (!VALID_PRIORITIES.includes(priority)) return apiError('Invalid priority', 400)

    // Verify client if changing
    if (body.clientId && body.clientId !== existing.clientId) {
      const client = await prisma.client.findFirst({ where: { id: body.clientId, userId: existing.userId } })
      if (!client) return apiError('Client not found', 404)
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        name,
        description: body.description !== undefined ? (body.description?.slice(0, MAX_TEXT_LENGTH) || null) : undefined,
        notes: body.notes !== undefined ? (body.notes?.slice(0, MAX_TEXT_LENGTH) || null) : undefined,
        status,
        priority,
        dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : undefined,
        budget: body.budget !== undefined ? (body.budget ? parseFloat(body.budget) : null) : undefined,
        hourlyRate: body.hourlyRate !== undefined ? (body.hourlyRate ? parseFloat(body.hourlyRate) : null) : undefined,
        clientId: body.clientId || undefined,
      },
    })

    return NextResponse.json(project)
  } catch (error) {
    console.error('API v1/projects/[id] PATCH error:', error)
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

    const existing = await prisma.project.findFirst({ where: { id, userId } })
    if (!existing) return apiError('Project not found', 404)

    // Soft delete, matching the web UI — the project stays recoverable from the
    // trash rather than cascade-deleting its tasks, time entries and images.
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API v1/projects/[id] DELETE error:', error)
    return apiError('Internal error', 500)
  }
}
