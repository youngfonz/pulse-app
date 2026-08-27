import { PrismaClient } from '@prisma/client'

// A project is trashed when `deletedAt` is set. Tasks, bookmarks and time entries
// have no `deletedAt` of their own — they are trashed implicitly with their
// project, so they are filtered by walking the relation. Tasks with no project
// (standalone tasks and bookmarks) are never affected.
const projectNotTrashed = { deletedAt: null }
const viaLiveProject = { NOT: { project: { is: { deletedAt: { not: null } } } } }
const ownedByLiveProject = { project: { is: { deletedAt: null } } }

// Prisma query extensions do not apply to nested relation reads, `findUnique`,
// or writes. Nested `include: { projects: ... }` reads must pass `where:
// { deletedAt: null }` themselves, and `findUnique` on a project should be a
// `findFirst` so it goes through this filter.
function createPrismaClient() {
  return new PrismaClient().$extends({
    query: {
      project: {
        async findMany({ args, query }) {
          args.where = { ...projectNotTrashed, ...args.where }
          return query(args)
        },
        async findFirst({ args, query }) {
          args.where = { ...projectNotTrashed, ...args.where }
          return query(args)
        },
        async count({ args, query }) {
          args.where = { ...projectNotTrashed, ...args.where }
          return query(args)
        },
        async aggregate({ args, query }) {
          args.where = { ...projectNotTrashed, ...args.where }
          return query(args)
        },
        async groupBy({ args, query }) {
          args.where = { ...projectNotTrashed, ...args.where }
          return query(args)
        },
      },
      task: {
        async findMany({ args, query }) {
          args.where = { AND: [viaLiveProject, args.where ?? {}] }
          return query(args)
        },
        async findFirst({ args, query }) {
          args.where = { AND: [viaLiveProject, args.where ?? {}] }
          return query(args)
        },
        async count({ args, query }) {
          args.where = { AND: [viaLiveProject, args.where ?? {}] }
          return query(args)
        },
        async aggregate({ args, query }) {
          args.where = { AND: [viaLiveProject, args.where ?? {}] }
          return query(args)
        },
        async groupBy({ args, query }) {
          args.where = { AND: [viaLiveProject, args.where ?? {}] }
          return query(args)
        },
      },
      timeEntry: {
        async findMany({ args, query }) {
          args.where = { AND: [ownedByLiveProject, args.where ?? {}] }
          return query(args)
        },
        async count({ args, query }) {
          args.where = { AND: [ownedByLiveProject, args.where ?? {}] }
          return query(args)
        },
        async aggregate({ args, query }) {
          args.where = { AND: [ownedByLiveProject, args.where ?? {}] }
          return query(args)
        },
      },
    },
  })
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
