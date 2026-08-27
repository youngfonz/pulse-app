import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { exchangeSlackCode } from '@/lib/slack'
import { getSubscriptionForUser } from '@/lib/subscription'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') // state = Pulse Pro userId

  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings?slack=error#slack', request.url))
  }

  // The callback must come from the signed-in user who started the flow. Without
  // this, anyone could replay their own Slack `code` with a victim's userId as
  // `state` and attach their Slack workspace to the victim's account.
  const { userId } = await auth()
  if (!userId || userId !== state) {
    return NextResponse.redirect(new URL('/settings?slack=error#slack', request.url))
  }

  // Gate: only Pro/Team users can connect Slack
  try {
    const sub = await getSubscriptionForUser(userId)
    if (sub.plan === 'free') {
      return NextResponse.redirect(new URL('/settings?slack=upgrade#slack', request.url))
    }
  } catch {
    return NextResponse.redirect(new URL('/settings?slack=error#slack', request.url))
  }

  // Exchange OAuth code for access token
  const token = await exchangeSlackCode(code)
  if (!token.ok || !token.team?.id || !token.authed_user?.id) {
    return NextResponse.redirect(new URL('/settings?slack=error#slack', request.url))
  }

  await prisma.subscription.update({
    where: { userId },
    data: {
      slackTeamId: token.team.id,
      slackUserId: token.authed_user.id,
      slackBotToken: token.access_token ?? null,
      slackInstalledAt: new Date(),
    },
  })

  return NextResponse.redirect(new URL('/settings?slack=connected#slack', request.url))
}
