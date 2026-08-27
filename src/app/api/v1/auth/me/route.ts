import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, apiError, handleCors } from '@/lib/api-auth'
import { isAdminUser } from '@/lib/auth'
import { getSubscriptionForUser, PLAN_LIMITS } from '@/lib/subscription'

export async function OPTIONS() { return handleCors() }

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    if ('error' in auth) return apiError(auth.error, auth.status)
    const { userId } = auth

    // Check maintenance mode
    const config = await prisma.systemConfig.findUnique({ where: { key: 'maintenance_mode' } })
    if (config?.value === 'true' && !isAdminUser(userId)) {
      return apiError('System is under maintenance', 503)
    }

    const subscription = await getSubscriptionForUser(userId)

    if (subscription.suspendedAt) {
      return apiError('Account suspended', 403)
    }

    const limits = PLAN_LIMITS[subscription.plan]

    const [projectCount, taskCount, clientCount] = await Promise.all([
      prisma.project.count({ where: { userId } }),
      prisma.task.count({ where: { userId, url: null } }),
      prisma.client.count({ where: { userId } }),
    ])

    return NextResponse.json({
      userId,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      hasPortal: subscription.hasPortal,
      usage: {
        projects: { current: projectCount, limit: limits.maxProjects },
        tasks: { current: taskCount, limit: limits.maxTasks },
        clients: { current: clientCount, limit: limits.maxClients },
      },
    })
  } catch (error) {
    console.error('API v1/auth/me error:', error)
    return apiError('Internal error', 500)
  }
}
