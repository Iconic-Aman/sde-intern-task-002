import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

async function getName(request: Request) {
  try {
    const body: unknown = await request.json()
    if (
      typeof body === 'object' &&
      body !== null &&
      'name' in body &&
      typeof body.name === 'string' &&
      body.name.trim()
    )
      return { name: body.name.trim() }
  } catch {
    return { error: 'Invalid JSON', status: 400 as const }
  }
  return { error: 'Name must be a non-empty string', status: 422 as const }
}

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const result = await getName(c.req.raw)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, result.name).run()
  return c.json({ id, name: result.name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const result = await getName(c.req.raw)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, result.name)
    .run()
  return c.json({ id, homeId, name: result.name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('title' in body) ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    !('totalCents' in body) ||
    typeof body.totalCents !== 'number' ||
    !Number.isSafeInteger(body.totalCents) ||
    body.totalCents <= 0
  )
    return c.json({ error: 'Invalid bill title or total' }, 422)

  const members = await c.env.DB.prepare('SELECT id FROM members WHERE home_id = ? ORDER BY rowid')
    .bind(homeId)
    .all<{ id: string }>()
  if (!members.results.length) return c.json({ error: 'Home has no members' }, 422)

  const id = crypto.randomUUID()
  const title = body.title.trim()
  const totalCents = body.totalCents
  const base = Math.floor(totalCents / members.results.length)
  const extra = totalCents % members.results.length
  const shares = members.results.map((member, i) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: base + (i < extra ? 1 : 0),
    paidAt: null,
  }))
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(id, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, id, share.memberId, share.amountCents),
    ),
  ])
  return c.json({ id, homeId, title, totalCents, shares }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)
  const { results } = await c.env.DB.prepare(
    'SELECT b.id, b.title, b.total_cents AS totalCents, s.id AS shareId, s.member_id AS memberId, m.name AS memberName, s.amount_cents AS amountCents, s.paid_at AS paidAt FROM bills b JOIN shares s ON s.bill_id = b.id JOIN members m ON m.id = s.member_id WHERE b.home_id = ? ORDER BY b.rowid, s.rowid',
  )
    .bind(homeId)
    .all<{
      id: string
      title: string
      totalCents: number
      shareId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>()
  const bills = new Map<
    string,
    {
      id: string
      title: string
      totalCents: number
      shares: {
        id: string
        memberId: string
        memberName: string
        amountCents: number
        paidAt: string | null
      }[]
    }
  >()
  for (const row of results) {
    let bill = bills.get(row.id)
    if (!bill) {
      bill = { id: row.id, title: row.title, totalCents: row.totalCents, shares: [] }
      bills.set(row.id, bill)
    }
    bill.shares.push({
      id: row.shareId,
      memberId: row.memberId,
      memberName: row.memberName,
      amountCents: row.amountCents,
      paidAt: row.paidAt,
    })
  }
  return c.json({ bills: [...bills.values()] })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return c.json({ error: 'Idempotency-Key is required' }, 400)
  const { billId, shareId } = c.req.param()
  const paidAt = new Date().toISOString()
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, payment_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key, shareId, billId)
    .run()
  const share = await c.env.DB.prepare(
    'SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt, payment_key AS paymentKey FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      paymentKey: string | null
    }>()
  if (!share) return c.json({ error: 'Bill or share not found' }, 404)
  if (result.meta.changes === 0 && share.paymentKey !== key)
    return c.json({ error: 'Share already paid with a different key' }, 409)
  return c.json({
    id: share.id,
    memberId: share.memberId,
    amountCents: share.amountCents,
    paidAt: share.paidAt,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)
  const { results } = await c.env.DB.prepare(
    'SELECT m.id AS memberId, m.name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents FROM members m LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL WHERE m.home_id = ? GROUP BY m.id ORDER BY m.rowid',
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()
  return c.json({ balances: results })
})

export default app
