import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import { checkLimitForUser } from '@/lib/subscription'
import {
  VALID_CLIENT_STATUSES,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from '@/actions/clients-validation'

export async function OPTIONS() { return handleCors() }

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth

    const url = new URL(request.url)
    const search = url.searchParams.get('search')
    const status = url.searchParams.get('status')
    const sort = url.searchParams.get('sort')

    const where: Record<string, unknown> = { userId }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status && status !== 'all') {
      where.status = status
    }

    type OrderBy = Record<string, 'asc' | 'desc'>
    let orderBy: OrderBy = { name: 'asc' }
    let sortByProjects = false

    switch (sort) {
      case 'name': orderBy = { name: 'asc' }; break
      case 'name_desc': orderBy = { name: 'desc' }; break
      case 'company': orderBy = { company: 'asc' }; break
      case 'newest': orderBy = { createdAt: 'desc' }; break
      case 'oldest': orderBy = { createdAt: 'asc' }; break
      case 'projects': case 'projects_desc': sortByProjects = true; break
    }

    const clients = await prisma.client.findMany({
      where,
      include: {
        _count: { select: { projects: { where: { deletedAt: null } } } },
      },
      orderBy,
    })

    if (sortByProjects) {
      clients.sort((a, b) =>
        sort === 'projects_desc'
          ? b._count.projects - a._count.projects
          : a._count.projects - b._count.projects
      )
    }

    return NextResponse.json({ clients })
  } catch (error) {
    console.error('API v1/clients GET error:', error)
    return apiError('Internal error', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth

    const limit = await checkLimitForUser(userId, 'clients')
    if (!limit.allowed) {
      return apiError(`Plan limit reached: ${limit.limit} client(s). Upgrade to Pro.`, 403)
    }

    const body = await request.json()
    const name = (body.name || '').slice(0, MAX_NAME_LENGTH)
    if (!name.trim()) return apiError('Name is required', 400)
    const status = body.status || 'active'
    if (!VALID_CLIENT_STATUSES.includes(status)) return apiError('Invalid status', 400)

    const client = await prisma.client.create({
      data: {
        userId,
        name,
        email: (body.email || '').slice(0, 320) || null,
        phone: (body.phone || '').slice(0, 50) || null,
        company: (body.company || '').slice(0, MAX_NAME_LENGTH) || null,
        logo: (body.logo || '').slice(0, 2000) || null,
        status,
        notes: (body.notes || '').slice(0, MAX_TEXT_LENGTH) || null,
      },
    })

    return NextResponse.json(client, { status: 201 })
  } catch (error) {
    console.error('API v1/clients POST error:', error)
    return apiError('Internal error', 500)
  }
}
