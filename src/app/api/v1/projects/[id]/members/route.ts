import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import { checkCollaboratorLimitForUser } from '@/lib/subscription'

export async function OPTIONS() { return handleCors() }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth
    const { id: projectId } = await params

    // Verify access (viewer+)
    let hasAccess = !!(await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    }))
    if (!hasAccess) {
      const access = await prisma.projectAccess.findUnique({
        where: { projectId_userId: { projectId, userId } },
      })
      hasAccess = !!access
    }
    if (!hasAccess) return apiError('Project not found', 404)

    const project = await prisma.project.findFirst({
      where: { id: projectId },
      select: { userId: true },
    })
    if (!project) return apiError('Project not found', 404)

    const accessRecords = await prisma.projectAccess.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      ownerId: project.userId,
      members: accessRecords.map(r => ({
        userId: r.userId,
        role: r.role,
        createdAt: r.createdAt,
      })),
    })
  } catch (error) {
    console.error('API v1/projects/[id]/members GET error:', error)
    return apiError('Internal error', 500)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth
    const { id: projectId } = await params

    const body = await request.json()
    const { targetUserId, role } = body

    if (!targetUserId) return apiError('targetUserId is required', 400)
    const validRoles = ['viewer', 'editor', 'manager']
    if (!role || !validRoles.includes(role)) return apiError('Invalid role', 400)

    // Only owners can grant manager; managers can grant editor/viewer
    const project = await prisma.project.findFirst({ where: { id: projectId, userId } })
    const isOwner = !!project

    if (!isOwner) {
      const access = await prisma.projectAccess.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      })
      if (!access || access.role !== 'manager') {
        return apiError('Insufficient permissions', 403)
      }
      if (role === 'manager') {
        return apiError('Only project owner can grant manager role', 403)
      }
    }

    if (targetUserId === userId) return apiError('Cannot grant access to yourself', 400)

    // Check if target is already owner
    const projectRecord = await prisma.project.findFirst({
      where: { id: projectId },
      select: { userId: true },
    })
    if (projectRecord?.userId === targetUserId) {
      return apiError('User is already the project owner', 400)
    }

    const existing = await prisma.projectAccess.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    })

    // Limit is on the project owner's plan, not the requester's.
    // Skip check on re-grant (existing row) since count doesn't grow.
    if (!existing) {
      const limit = await checkCollaboratorLimitForUser(
        projectRecord?.userId ?? userId,
        projectId,
      )
      if (!limit.allowed) {
        return apiError(`Collaborator limit reached for ${limit.plan} plan`, 403)
      }
    }

    await prisma.projectAccess.upsert({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      create: { projectId, userId: targetUserId, role, grantedBy: userId },
      update: { role },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('API v1/projects/[id]/members POST error:', error)
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
    const { id: projectId } = await params

    const url = new URL(request.url)
    const targetUserId = url.searchParams.get('userId')
    if (!targetUserId) return apiError('userId query param is required', 400)

    // Check permissions (manager+)
    const project = await prisma.project.findFirst({ where: { id: projectId, userId } })
    if (!project) {
      const access = await prisma.projectAccess.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      })
      if (!access || access.role !== 'manager') {
        return apiError('Insufficient permissions', 403)
      }
    }

    await prisma.projectAccess.deleteMany({
      where: { projectId, userId: targetUserId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API v1/projects/[id]/members DELETE error:', error)
    return apiError('Internal error', 500)
  }
}
