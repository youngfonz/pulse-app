'use server'

import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { sendInvoiceEmail } from '@/lib/email'
import { resolveInvoiceProjectId, validateInvoiceItems } from '@/lib/invoice-validation'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getNextInvoiceNumber(): Promise<string> {
  const userId = await requireUserId()

  const latest = await prisma.invoice.findFirst({
    where: { userId },
    orderBy: { number: 'desc' },
    select: { number: true },
  })

  let next = 1

  if (latest?.number) {
    // number is stored as "INV-001", parse the numeric part
    const parsed = parseInt(latest.number.replace('INV-', ''), 10)
    if (!isNaN(parsed)) {
      next = parsed + 1
    }
  }

  return `INV-${String(next).padStart(3, '0')}`
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getInvoices(filters?: {
  search?: string
  status?: string
  clientId?: string
  sort?: string
}) {
  try {
    const userId = await requireUserId()
    const where: Record<string, unknown> = { userId }
    const conditions: Record<string, unknown>[] = []

    if (filters?.search) {
      conditions.push({
        OR: [
          { number: { contains: filters.search, mode: 'insensitive' } },
          { client: { name: { contains: filters.search, mode: 'insensitive' } } },
        ],
      })
    }

    if (filters?.status && filters.status !== 'all') {
      if (filters.status === 'overdue') {
        // Overdue = sent + past due date
        conditions.push({ status: 'sent', dueDate: { lt: new Date() } })
      } else {
        conditions.push({ status: filters.status })
      }
    }

    if (filters?.clientId && filters.clientId !== 'all') {
      conditions.push({ clientId: filters.clientId })
    }

    if (conditions.length > 0) {
      where.AND = conditions
    }

    type OrderBy = Record<string, 'asc' | 'desc'>
    let orderBy: OrderBy = { createdAt: 'desc' }

    switch (filters?.sort) {
      case 'oldest':
        orderBy = { createdAt: 'asc' }
        break
      case 'amount':
        // amount is computed from items; fall back to createdAt, sort in memory below
        orderBy = { createdAt: 'desc' }
        break
      case 'number':
        orderBy = { number: 'asc' }
        break
      default:
        orderBy = { createdAt: 'desc' }
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          select: {
            amount: true,
          },
        },
      },
      orderBy,
    })

    // Compute total and auto-detect overdue status
    const now = new Date()
    const withTotal = invoices.map((invoice) => {
      const subtotal = invoice.items.reduce((sum, item) => sum + item.amount, 0)
      const total = subtotal + subtotal * (invoice.taxRate / 100)
      const status = invoice.status === 'sent' && invoice.dueDate < now ? 'overdue' : invoice.status
      return { ...invoice, status, subtotal, total }
    })

    // In-memory sort for amount (Prisma can't aggregate across relations)
    if (filters?.sort === 'amount') {
      withTotal.sort((a, b) => b.total - a.total)
    }

    return withTotal
  } catch (error) {
    console.error('Failed to fetch invoices:', error)
    return []
  }
}

export async function getInvoice(id: string) {
  try {
    const userId = await requireUserId()

    const invoice = await prisma.invoice.findFirst({
      where: { id, userId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            hourlyRate: true,
          },
        },
        items: true,
      },
    })

    if (!invoice) return null

    const subtotal = invoice.items.reduce((sum, item) => sum + item.amount, 0)
    const total = subtotal + subtotal * (invoice.taxRate / 100)
    const status = invoice.status === 'sent' && invoice.dueDate < new Date() ? 'overdue' : invoice.status

    return { ...invoice, status, subtotal, total }
  } catch (error) {
    console.error('Failed to fetch invoice:', error)
    return null
  }
}

// Public — no auth required. Used for the shareable invoice link.
export async function getInvoiceByToken(token: string) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { shareToken: token },
      include: {
        client: {
          select: {
            name: true,
            email: true,
            company: true,
          },
        },
        project: {
          select: {
            name: true,
          },
        },
        items: true,
      },
    })

    if (!invoice) return null

    const subtotal = invoice.items.reduce((sum, item) => sum + item.amount, 0)
    const total = subtotal + subtotal * (invoice.taxRate / 100)
    const status = invoice.status === 'sent' && invoice.dueDate < new Date() ? 'overdue' : invoice.status

    // Anyone holding the link reaches this, so keep internal identifiers out of
    // the payload — the page renders none of them.
    const { userId: _userId, shareToken: _shareToken, clientId: _clientId, projectId: _projectId, ...publicFields } = invoice

    return { ...publicFields, status, subtotal, total }
  } catch (error) {
    console.error('Failed to fetch invoice by token:', error)
    return null
  }
}

export async function getClientsForInvoice() {
  try {
    const userId = await requireUserId()

    return prisma.client.findMany({
      where: { userId, status: 'active' },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        projects: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            hourlyRate: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })
  } catch (error) {
    console.error('Failed to fetch clients for invoice:', error)
    return []
  }
}

export async function getTimeEntriesForImport(projectId: string) {
  try {
    const userId = await requireUserId()

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { hourlyRate: true },
    })

    if (!project) throw new Error('Project not found')

    const entries = await prisma.timeEntry.findMany({
      where: { projectId },
      select: {
        id: true,
        hours: true,
        description: true,
        date: true,
      },
      orderBy: { date: 'desc' },
    })

    return {
      entries,
      hourlyRate: project.hourlyRate ?? null,
    }
  } catch (error) {
    console.error('Failed to fetch time entries for import:', error)
    throw error instanceof Error ? error : new Error('Failed to fetch time entries')
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type InvoiceItemInput = {
  description: string
  quantity: number
  rate: number
}

type InvoiceInput = {
  clientId: string
  projectId?: string | null
  dueDate: string | Date
  taxRate?: number
  notes?: string | null
  fromName?: string | null
  fromEmail?: string | null
  fromAddress?: string | null
  items: InvoiceItemInput[]
}

export async function createInvoice(data: InvoiceInput) {
  try {
    const userId = await requireUserId()

    // Verify the client belongs to this user
    const client = await prisma.client.findFirst({ where: { id: data.clientId, userId } })
    if (!client) throw new Error('Client not found')

    const projectId = await resolveInvoiceProjectId({
      projectId: data.projectId,
      userId,
      clientId: data.clientId,
    })
    const items = validateInvoiceItems(data.items)

    // Prevent email header injection
    if (data.fromEmail && /[\r\n]/.test(data.fromEmail)) throw new Error('Invalid email format')
    if (data.fromName && /[\r\n]/.test(data.fromName)) throw new Error('Invalid name format')
    if (data.fromAddress && /[\r\n]/.test(data.fromAddress)) throw new Error('Invalid address format')

    const number = await getNextInvoiceNumber()

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          userId,
          number,
          clientId: data.clientId,
          projectId,
          dueDate: new Date(data.dueDate),
          taxRate: data.taxRate ?? 0,
          notes: data.notes ?? null,
          fromName: data.fromName ?? null,
          fromEmail: data.fromEmail ?? null,
          fromAddress: data.fromAddress ?? null,
          shareToken: crypto.randomBytes(16).toString('hex'),
        },
      })

      await tx.invoiceItem.createMany({
        data: items.map((item) => ({
          invoiceId: created.id,
          description: item.description,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        })),
      })

      return created
    })

    revalidatePath('/invoices')
    return invoice
  } catch (error) {
    console.error('Failed to create invoice:', error)
    throw error instanceof Error ? error : new Error('Failed to create invoice')
  }
}

export async function updateInvoice(id: string, data: InvoiceInput) {
  try {
    const userId = await requireUserId()

    const existing = await prisma.invoice.findFirst({ where: { id, userId } })
    if (!existing) throw new Error('Invoice not found')
    if (existing.status !== 'draft') throw new Error('Only draft invoices can be edited')

    // Verify the client belongs to this user (prevent IDOR)
    const client = await prisma.client.findFirst({ where: { id: data.clientId, userId } })
    if (!client) throw new Error('Client not found')

    const projectId = await resolveInvoiceProjectId({
      projectId: data.projectId,
      userId,
      clientId: data.clientId,
    })
    const items = validateInvoiceItems(data.items)

    // Prevent email header injection
    if (data.fromEmail && /[\r\n]/.test(data.fromEmail)) throw new Error('Invalid email format')
    if (data.fromName && /[\r\n]/.test(data.fromName)) throw new Error('Invalid name format')
    if (data.fromAddress && /[\r\n]/.test(data.fromAddress)) throw new Error('Invalid address format')

    await prisma.$transaction(async (tx) => {
      // Delete existing items and recreate
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })

      await tx.invoice.update({
        where: { id },
        data: {
          clientId: data.clientId,
          projectId,
          dueDate: new Date(data.dueDate),
          taxRate: data.taxRate ?? 0,
          notes: data.notes ?? null,
          fromName: data.fromName ?? null,
          fromEmail: data.fromEmail ?? null,
          fromAddress: data.fromAddress ?? null,
        },
      })

      await tx.invoiceItem.createMany({
        data: items.map((item) => ({
          invoiceId: id,
          description: item.description,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        })),
      })
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${id}`)
  } catch (error) {
    console.error('Failed to update invoice:', error)
    throw error instanceof Error ? error : new Error('Failed to update invoice')
  }
}

export async function deleteInvoice(id: string) {
  try {
    const userId = await requireUserId()

    const invoice = await prisma.invoice.findFirst({ where: { id, userId } })
    if (!invoice) throw new Error('Invoice not found')
    if (invoice.status !== 'draft') throw new Error('Only draft invoices can be deleted')

    await prisma.invoice.delete({ where: { id } })

    revalidatePath('/invoices')
  } catch (error) {
    console.error('Failed to delete invoice:', error)
    throw error instanceof Error ? error : new Error('Failed to delete invoice')
  }
}

export async function sendInvoice(id: string) {
  try {
    const userId = await requireUserId()

    const invoice = await prisma.invoice.findFirst({
      where: { id, userId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        items: true,
      },
    })

    if (!invoice) throw new Error('Invoice not found')
    if (!invoice.client.email) {
      throw new Error(`Client "${invoice.client.name}" has no email address. Add an email in their client profile first.`)
    }

    const subtotal = invoice.items.reduce((sum, item) => sum + item.amount, 0)
    const total = subtotal + subtotal * (invoice.taxRate / 100)

    await prisma.invoice.update({
      where: { id },
      data: { status: 'sent' },
    })

    await sendInvoiceEmail({ ...invoice, subtotal, total })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${id}`)
  } catch (error) {
    console.error('Failed to send invoice:', error)
    throw error instanceof Error ? error : new Error('Failed to send invoice')
  }
}

export async function markInvoicePaid(id: string) {
  try {
    const userId = await requireUserId()

    const invoice = await prisma.invoice.findFirst({ where: { id, userId } })
    if (!invoice) throw new Error('Invoice not found')

    await prisma.invoice.update({
      where: { id },
      data: {
        status: 'paid',
        paidAt: new Date(),
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${id}`)
  } catch (error) {
    console.error('Failed to mark invoice as paid:', error)
    throw error instanceof Error ? error : new Error('Failed to mark invoice as paid')
  }
}
