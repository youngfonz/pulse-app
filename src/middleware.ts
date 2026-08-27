import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest } from 'next/server'

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

// Static pages and metadata routes — bypass Clerk entirely
// Note: '/' is NOT bypassed because page.tsx calls auth() to redirect logged-in users
const bypassPaths = new Set(['/about', '/contact', '/privacy', '/terms', '/maintenance', '/suspended', '/sitemap.xml', '/robots.txt', '/qa-results.json'])

const isPublicRoute = createRouteMatcher([
  '/',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/kb',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/login',
  '/signup',
  '/api/webhook/polar',
  '/api/webhook/clerk',
  '/api/cron/daily-reminder',
  '/api/webhook/telegram',
  '/api/webhook/email',
  '/api/webhook/slack/(.*)',
  '/api/v1/(.*)',
  '/api/og',
  '/invoice/(.*)',
  '/maintenance',
  '/suspended',
])

const clerkHandler = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export default function middleware(request: NextRequest) {
  if (bypassPaths.has(request.nextUrl.pathname)) {
    return NextResponse.next()
  }
  if (!clerkEnabled) {
    return NextResponse.next()
  }
  return clerkHandler(request, {} as any)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
