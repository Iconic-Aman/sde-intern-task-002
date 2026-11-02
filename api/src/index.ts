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

app.get('/api/health', (c) => c.json({ status: 'server is healthy' }))

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

export default app
