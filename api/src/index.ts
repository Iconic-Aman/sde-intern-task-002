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

export default app
