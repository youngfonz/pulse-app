import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import {
  VALID_CLIENT_STATUSES,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from '@/actions/clients-validation'

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

    const client = await prisma.client.findFirst({
      where: { id, userId },
      include: {
        projects: {
          where: { deletedAt: null },
          include: {
            _count: { select: { tasks: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!client) return apiError('Client not found', 404)
    return NextResponse.json(client)
  } catch (error) {
    console.error('API v1/clients/[id] GET error:', error)
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

    const existing = await prisma.client.findFirst({ where: { id, userId } })
    if (!existing) return apiError('Client not found', 404)

    const body = await request.json()
    const name = (body.name || existing.name).slice(0, MAX_NAME_LENGTH)
    if (!name.trim()) return apiError('Name is required', 400)

    const status = body.status || existing.status
    if (!VALID_CLIENT_STATUSES.includes(status)) return apiError('Invalid status', 400)

    const client = await prisma.client.update({
      where: { id },
      data: {
        name,
        email: body.email !== undefined ? (body.email || '').slice(0, 320) || null : undefined,
        phone: body.phone !== undefined ? (body.phone || '').slice(0, 50) || null : undefined,
        company: body.company !== undefined ? (body.company || '').slice(0, MAX_NAME_LENGTH) || null : undefined,
        logo: body.logo !== undefined ? (body.logo || '').slice(0, 2000) || null : undefined,
        status,
        notes: body.notes !== undefined ? (body.notes || '').slice(0, MAX_TEXT_LENGTH) || null : undefined,
      },
    })

    return NextResponse.json(client)
  } catch (error) {
    console.error('API v1/clients/[id] PATCH error:', error)
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

    const existing = await prisma.client.findFirst({ where: { id, userId } })
    if (!existing) return apiError('Client not found', 404)

    await prisma.client.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API v1/clients/[id] DELETE error:', error)
    return apiError('Internal error', 500)
  }
}
