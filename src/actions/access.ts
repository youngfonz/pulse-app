'use server'

import { prisma } from '@/lib/prisma'
import { requireUserId, getOrgId } from '@/lib/auth'
import { requireProjectAccess } from '@/lib/access'
import { checkCollaboratorLimit } from '@/lib/subscription'
import { clerkClient } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

export async function grantProjectAccess(
  projectId: string,
  targetUserId: string,
  role: 'viewer' | 'editor' | 'manager'
) {
  // Only owners can grant manager role
  const minRole = role === 'manager' ? 'owner' : 'manager'
  await requireProjectAccess(projectId, minRole)
  const userId = await requireUserId()

  if (targetUserId === userId) throw new Error('Cannot grant access to yourself')

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, userId: true },
  })
  if (!project) throw new Error('Project not found')
  if (targetUserId === project.userId) throw new Error('User is already the project owner')

  // Check collaborator limit based on plan
  const existing = await prisma.projectAccess.findUnique({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  })
  if (!existing) {
    const collabLimit = await checkCollaboratorLimit(projectId)
    if (!collabLimit.allowed) {
      if (collabLimit.limit === 0) {
        throw new Error('Upgrade to Pro to share projects with collaborators.')
      }
      throw new Error(
        collabLimit.plan === 'team'
          ? `You've reached the maximum of ${collabLimit.limit} collaborators per project.`
          : `Your ${collabLimit.plan} plan allows ${collabLimit.limit} collaborators per project. Upgrade to Team for up to 10.`
      )
    }
  }

  await prisma.projectAccess.upsert({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    create: { projectId, userId: targetUserId, role, grantedBy: userId },
    update: { role },
  })

  revalidatePath(`/projects/${projectId}`)
}

export async function grantProjectAccessByEmail(
  projectId: string,
  email: string,
  role: 'viewer' | 'editor' | 'manager'
) {
  const userId = await requireUserId()
  await requireProjectAccess(projectId, role === 'manager' ? 'owner' : 'manager')

  const emailTrimmed = email.trim().toLowerCase()
  if (!emailTrimmed || !emailTrimmed.includes('@')) throw new Error('Invalid email address')

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, userId: true },
  })
  if (!project) throw new Error('Project not found')

  // Look up Clerk user by email
  const clerk = await clerkClient()
  const users = await clerk.users.getUserList({
    emailAddress: [emailTrimmed],
    limit: 1,
  })

  if (users.data.length === 0) {
    throw new Error(`No Pulse Pro account found for ${emailTrimmed}. They need to sign up first at pulsepro.org.`)
  }

  const targetUser = users.data[0]
  if (targetUser.id === userId) throw new Error('Cannot add yourself as a team member')
  if (targetUser.id === project.userId) throw new Error('That user is already the project owner')

  // Check collaborator limit
  const existing = await prisma.projectAccess.findUnique({
    where: { projectId_userId: { projectId, userId: targetUser.id } },
  })
  if (!existing) {
    const collabLimit = await checkCollaboratorLimit(projectId)
    if (!collabLimit.allowed) {
      if (collabLimit.limit === 0) {
        throw new Error('Upgrade to Pro to share projects with collaborators.')
      }
      throw new Error(
        collabLimit.plan === 'team'
          ? `You've reached the maximum of ${collabLimit.limit} collaborators per project.`
          : `Your ${collabLimit.plan} plan allows ${collabLimit.limit} collaborators per project. Upgrade to Team for up to 10.`
      )
    }
  }

  await prisma.projectAccess.upsert({
    where: { projectId_userId: { projectId, userId: targetUser.id } },
    create: { projectId, userId: targetUser.id, role, grantedBy: userId },
    update: { role },
  })

  revalidatePath(`/projects/${projectId}`)

  const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || emailTrimmed
  return { name, email: emailTrimmed }
}

export async function revokeProjectAccess(
  projectId: string,
  targetUserId: string
) {
  await requireProjectAccess(projectId, 'manager')

  await prisma.projectAccess.deleteMany({
    where: { projectId, userId: targetUserId },
  })

  revalidatePath(`/projects/${projectId}`)
}

export async function getProjectMembers(projectId: string) {
  await requireProjectAccess(projectId, 'viewer')

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { userId: true },
  })
  if (!project) return { owner: null, members: [] }

  const accessRecords = await prisma.projectAccess.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  })

  const allUserIds = [project.userId, ...accessRecords.map(r => r.userId)].filter(Boolean) as string[]
  const uniqueIds = [...new Set(allUserIds)]

  const clerk = await clerkClient()
  const users = await clerk.users.getUserList({
    userId: uniqueIds,
    limit: uniqueIds.length,
  })
  const userMap = new Map(users.data.map(u => [u.id, {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.emailAddresses[0]?.emailAddress || 'Unknown',
    email: u.emailAddresses[0]?.emailAddress ?? '',
    imageUrl: u.imageUrl,
  }]))

  return {
    owner: userMap.get(project.userId!) ?? null,
    members: accessRecords.map(r => ({
      userId: r.userId,
      role: r.role,
      createdAt: r.createdAt,
      user: userMap.get(r.userId) ?? { id: r.userId, name: 'Unknown', email: '', imageUrl: '' },
    })),
  }
}

export async function getOrgMembers() {
  const orgId = await getOrgId()
  if (!orgId) return []

  const clerk = await clerkClient()
  const memberships = await clerk.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 100,
  })

  return memberships.data.map(m => ({
    userId: m.publicUserData?.userId ?? '',
    name: [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') || 'Unknown',
    email: m.publicUserData?.identifier ?? '',
    imageUrl: m.publicUserData?.imageUrl ?? '',
    role: m.role,
  })).filter(m => m.userId)
}
