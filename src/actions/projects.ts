'use server'

import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth'
import { checkLimit } from '@/lib/subscription'
import { revalidatePath } from 'next/cache'
import { getProjectWhereWithAccess, canAccessProject, requireProjectAccess } from '@/lib/access'
import {
  VALID_PROJECT_STATUSES,
  VALID_PRIORITIES,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from './projects-validation'

export async function getProjects(filters?: {
  search?: string
  status?: string
  priority?: string
  clientId?: string
  sort?: string
}) {
  try {
    const baseWhere = await getProjectWhereWithAccess()
    const conditions: Record<string, unknown>[] = [baseWhere]
    const where: Record<string, unknown> = {}

    if (filters?.search) {
      conditions.push({
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ]
      })
    }

    if (filters?.status && filters.status !== 'all') {
      if (filters.status === 'completed') {
        conditions.push({
          OR: [
            { status: 'completed' },
            { tasks: { every: { OR: [{ status: 'done' }, { url: { not: null } }] }, some: { url: null } } },
          ],
        })
      } else {
        // For non-completed statuses, exclude projects where all real tasks (non-bookmarks) are done
        where.status = filters.status
        where.NOT = {
          tasks: { every: { OR: [{ status: 'done' }, { url: { not: null } }] }, some: { url: null } },
        }
      }
    }

    if (filters?.priority && filters.priority !== 'all') {
      where.priority = filters.priority
    }

    if (filters?.clientId && filters.clientId !== 'all') {
      where.clientId = filters.clientId
    }

    // Determine sort order
    type OrderBy = Record<string, 'asc' | 'desc' | Record<string, 'asc' | 'desc'>>
    let orderBy: OrderBy | OrderBy[] = { createdAt: 'desc' as const }
    let customSort: 'priority' | 'priority_desc' | 'status' | 'status_desc' | null = null

    switch (filters?.sort) {
      case 'oldest':
        orderBy = { createdAt: 'asc' }
        break
      case 'name':
        orderBy = { name: 'asc' }
        break
      case 'name_desc':
        orderBy = { name: 'desc' }
        break
      case 'client':
        orderBy = { client: { name: 'asc' } }
        break
      case 'client_desc':
        orderBy = { client: { name: 'desc' } }
        break
      case 'due_date':
        orderBy = [{ dueDate: 'asc' }, { createdAt: 'desc' }]
        break
      case 'due_date_desc':
        orderBy = [{ dueDate: 'desc' }, { createdAt: 'desc' }]
        break
      case 'priority_high':
        customSort = 'priority_desc'
        break
      case 'priority_low':
        customSort = 'priority'
        break
      case 'status':
        customSort = 'status'
        break
      case 'status_desc':
        customSort = 'status_desc'
        break
      default:
        orderBy = { createdAt: 'desc' }
    }

    where.AND = conditions

    const projects = await prisma.project.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        tasks: {
          select: { id: true, status: true, url: true, dueDate: true },
        },
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: customSort ? { createdAt: 'desc' } : orderBy,
    })

    // Apply custom sorting for priority and status (string enums that need logical ordering)
    if (customSort) {
      const priorityOrder = { low: 1, medium: 2, high: 3 }
      const statusOrder = { not_started: 1, in_progress: 2, on_hold: 3, completed: 4 }

      projects.sort((a, b) => {
        if (customSort === 'priority') {
          return priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder]
        } else if (customSort === 'priority_desc') {
          return priorityOrder[b.priority as keyof typeof priorityOrder] - priorityOrder[a.priority as keyof typeof priorityOrder]
        } else if (customSort === 'status') {
          return statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder]
        } else if (customSort === 'status_desc') {
          return statusOrder[b.status as keyof typeof statusOrder] - statusOrder[a.status as keyof typeof statusOrder]
        }
        return 0
      })
    }

    return projects
  } catch (error) {
    console.error('Failed to fetch projects:', error)
    return []
  }
}

export async function getProject(id: string) {
  try {
    const userId = await requireUserId()
    const include = {
      client: {
        select: {
          id: true,
          name: true,
        },
      },
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
      const hasAccess = await canAccessProject(id)
      if (hasAccess) {
        project = await prisma.project.findFirst({
          where: { id },
          include,
        })
      }
    }

    return project
  } catch (error) {
    console.error('Failed to fetch project:', error)
    return null
  }
}

export async function getProjectsForGantt() {
  try {
    const userId = await requireUserId()
    return prisma.project.findMany({
      where: { userId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        tasks: {
          orderBy: [
            { startDate: 'asc' },
            { dueDate: 'asc' },
          ],
        },
      },
      orderBy: { name: 'asc' },
    })
  } catch (error) {
    console.error('Failed to fetch projects for Gantt:', error)
    return []
  }
}

export async function createProject(formData: FormData) {
  try {
    const userId = await requireUserId()

    // Verify client belongs to this scope
    const clientId = formData.get('clientId') as string
    const client = await prisma.client.findFirst({ where: { id: clientId, userId } })
    if (!client) throw new Error('Client not found')

    const limit = await checkLimit('projects')
    if (!limit.allowed) {
      throw new Error(`Free plan limit: ${limit.limit} projects. Upgrade to Pro for unlimited projects.`)
    }

    const name = (formData.get('name') as string || '').slice(0, MAX_NAME_LENGTH)
    if (!name.trim()) throw new Error('Name is required')
    const status = formData.get('status') as string || 'not_started'
    if (!VALID_PROJECT_STATUSES.includes(status)) throw new Error('Invalid status')
    const priority = formData.get('priority') as string || 'medium'
    if (!VALID_PRIORITIES.includes(priority)) throw new Error('Invalid priority')

    const data = {
      userId,
      name,
      description: (formData.get('description') as string || '').slice(0, MAX_TEXT_LENGTH) || null,
      notes: (formData.get('notes') as string || '').slice(0, MAX_TEXT_LENGTH) || null,
      status,
      priority,
      dueDate: formData.get('dueDate')
        ? new Date(formData.get('dueDate') as string)
        : null,
      budget: formData.get('budget')
        ? parseFloat(formData.get('budget') as string)
        : null,
      hourlyRate: formData.get('hourlyRate')
        ? parseFloat(formData.get('hourlyRate') as string)
        : null,
      clientId: formData.get('clientId') as string,
    }

    const project = await prisma.project.create({ data })
    revalidatePath('/projects')
    revalidatePath(`/clients/${data.clientId}`)
    return project
  } catch (error) {
    console.error('Failed to create project:', error)
    throw error instanceof Error ? error : new Error('Failed to create project')
  }
}

export async function updateProject(id: string, formData: FormData) {
  try {
    const userId = await requireUserId()
    const existing = await prisma.project.findFirst({ where: { id, userId } })
    if (!existing) {
      await requireProjectAccess(id, 'manager')
    }

    const name = (formData.get('name') as string || '').slice(0, MAX_NAME_LENGTH)
    if (!name.trim()) throw new Error('Name is required')
    const status = formData.get('status') as string || 'not_started'
    if (!VALID_PROJECT_STATUSES.includes(status)) throw new Error('Invalid status')
    const priority = formData.get('priority') as string || 'medium'
    if (!VALID_PRIORITIES.includes(priority)) throw new Error('Invalid priority')

    // Verify the client belongs to the project owner (prevent IDOR)
    const clientId = formData.get('clientId') as string
    const projectOwner = existing?.userId ?? (await prisma.project.findFirst({ where: { id }, select: { userId: true } }))?.userId
    if (projectOwner) {
      const client = await prisma.client.findFirst({ where: { id: clientId, userId: projectOwner } })
      if (!client) throw new Error('Client not found')
    }

    const data = {
      name,
      description: (formData.get('description') as string || '').slice(0, MAX_TEXT_LENGTH) || null,
      notes: (formData.get('notes') as string || '').slice(0, MAX_TEXT_LENGTH) || null,
      status,
      priority,
      dueDate: formData.get('dueDate')
        ? new Date(formData.get('dueDate') as string)
        : null,
      budget: formData.get('budget')
        ? parseFloat(formData.get('budget') as string)
        : null,
      hourlyRate: formData.get('hourlyRate')
        ? parseFloat(formData.get('hourlyRate') as string)
        : null,
      clientId,
    }

    await prisma.project.update({
      where: { id },
      data,
    })
    revalidatePath('/projects')
    revalidatePath(`/projects/${id}`)
    revalidatePath(`/clients/${data.clientId}`)
    revalidatePath('/dashboard')
  } catch (error) {
    console.error('Failed to update project:', error)
    throw new Error('Failed to update project')
  }
}

export async function deleteProject(id: string) {
  try {
    const userId = await requireUserId()
    const project = await prisma.project.findFirst({ where: { id, userId } })
    if (!project) return

    await prisma.project.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    revalidatePath('/projects')
    revalidatePath(`/clients/${project.clientId}`)
    revalidatePath('/dashboard')
    revalidatePath('/tasks')
  } catch (error) {
    console.error('Failed to delete project:', error)
    throw new Error('Failed to delete project')
  }
}

export async function getDeletedProjects() {
  try {
    const userId = await requireUserId()
    return prisma.project.findMany({
      where: { userId, deletedAt: { not: null } },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { deletedAt: 'desc' },
    })
  } catch (error) {
    console.error('Failed to fetch deleted projects:', error)
    return []
  }
}

export async function restoreProject(id: string) {
  try {
    const userId = await requireUserId()
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    })
    if (!project) return

    // Trashed projects don't count toward the plan limit, so restoring one is a
    // new project as far as the limit is concerned.
    const limit = await checkLimit('projects')
    if (!limit.allowed) {
      throw new Error(`Plan limit reached: ${limit.limit} projects. Upgrade to restore this project.`)
    }

    await prisma.project.update({
      where: { id },
      data: { deletedAt: null },
    })
    revalidatePath('/projects')
    revalidatePath(`/clients/${project.clientId}`)
    revalidatePath('/dashboard')
    revalidatePath('/tasks')
  } catch (error) {
    console.error('Failed to restore project:', error)
    throw error instanceof Error ? error : new Error('Failed to restore project')
  }
}

export async function permanentDeleteProject(id: string) {
  try {
    const userId = await requireUserId()
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    })
    if (!project) return

    await prisma.project.delete({
      where: { id },
    })
    revalidatePath('/projects')
    revalidatePath(`/clients/${project.clientId}`)
  } catch (error) {
    console.error('Failed to permanently delete project:', error)
    throw new Error('Failed to permanently delete project')
  }
}

export async function getClientsForSelect() {
  try {
    const userId = await requireUserId()
    return prisma.client.findMany({
      where: { userId, status: 'active' },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    })
  } catch (error) {
    console.error('Failed to fetch clients for select:', error)
    return []
  }
}

export async function addProjectImage(projectId: string, path: string, name: string) {
  try {
    const userId = await requireUserId()
    const project = await prisma.project.findFirst({ where: { id: projectId, userId } })
    if (!project) {
      await requireProjectAccess(projectId, 'editor')
    }

    await prisma.projectImage.create({
      data: {
        path,
        name,
        projectId,
      },
    })
    revalidatePath(`/projects/${projectId}`)
  } catch (error) {
    console.error('Failed to add project image:', error)
    throw new Error('Failed to add project image')
  }
}

export async function removeProjectImage(imageId: string) {
  try {
    const userId = await requireUserId()
    const image = await prisma.projectImage.findUnique({
      where: { id: imageId },
      include: { project: { select: { id: true, userId: true } } },
    })

    if (!image) return
    if (image.project.userId !== userId) {
      await requireProjectAccess(image.project.id, 'editor')
    }

    await prisma.projectImage.delete({
      where: { id: imageId },
    })
    revalidatePath(`/projects/${image.project.id}`)
  } catch (error) {
    console.error('Failed to remove project image:', error)
    throw new Error('Failed to remove project image')
  }
}

// Time Entry Actions
export async function addTimeEntry(projectId: string, formData: FormData) {
  try {
    const userId = await requireUserId()
    const project = await prisma.project.findFirst({ where: { id: projectId, userId } })
    if (!project) {
      await requireProjectAccess(projectId, 'editor')
    }

    const hours = parseFloat(formData.get('hours') as string)
    const description = formData.get('description') as string || null
    const dateStr = formData.get('date') as string

    await prisma.timeEntry.create({
      data: {
        hours,
        description,
        date: dateStr ? new Date(dateStr) : new Date(),
        projectId,
      },
    })
    revalidatePath(`/projects/${projectId}`)
  } catch (error) {
    console.error('Failed to add time entry:', error)
    throw new Error('Failed to add time entry')
  }
}

export async function deleteTimeEntry(id: string) {
  try {
    const userId = await requireUserId()
    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: { project: { select: { id: true, userId: true } } },
    })

    if (!entry) return
    if (entry.project.userId !== userId) {
      await requireProjectAccess(entry.project.id, 'editor')
    }

    await prisma.timeEntry.delete({
      where: { id },
    })
    revalidatePath(`/projects/${entry.project.id}`)
  } catch (error) {
    console.error('Failed to delete time entry:', error)
    throw new Error('Failed to delete time entry')
  }
}
