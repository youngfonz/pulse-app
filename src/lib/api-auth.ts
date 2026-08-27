import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { isAdminUser } from '@/lib/auth'
import crypto from 'crypto'

type AuthResult =
  | { userId: string }
  | { error: string; status: number }

/**
 * Authenticate an API request using Clerk JWT (mobile app) or API token (Siri/Shortcuts).
 * Tries JWT first, then falls back to API token auth.
 */
export async function authenticateRequest(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing Authorization header', status: 401 }
  }

  const token = authHeader.slice(7)
  if (!token) {
    return { error: 'Missing token', status: 401 }
  }

  // Try Clerk JWT first (mobile app)
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    })
    if (payload.sub) {
      if (await isSuspended(payload.sub)) {
        return { error: 'Account suspended', status: 403 }
      }
      return { userId: payload.sub }
    }
  } catch {
    // Not a valid JWT — try API token auth below
  }

  // Fall back to API token auth (Siri/Shortcuts)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const subscription = await prisma.subscription.findFirst({
    where: { apiToken: tokenHash },
  })

  if (!subscription) {
    return { error: 'Invalid token', status: 401 }
  }

  if (subscription.suspendedAt) {
    return { error: 'Account suspended', status: 403 }
  }

  if (subscription.plan !== 'pro' && subscription.plan !== 'team' && !isAdminUser(subscription.userId)) {
    return { error: 'Pro plan required for API access', status: 403 }
  }

  return { userId: subscription.userId }
}

/**
 * Suspension is enforced in the web app by LayoutWrapper. The API is a separate
 * entry point (mobile app, Siri shortcuts), so it has to check independently.
 */
async function isSuspended(userId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { suspendedAt: true },
  })
  return !!subscription?.suspendedAt
}

/**
 * Helper to return a JSON error response.
 */
export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Helper to handle OPTIONS preflight requests.
 */
export function handleCors() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://pulsepro.work',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
