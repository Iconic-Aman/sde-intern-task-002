import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}
type Bill = { id: string; title: string; totalCents: number; shares: Share[] }

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [homeId, setHomeId] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState<string | null>(null)
  const [paymentKeys, setPaymentKeys] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')

  async function loadBills(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setLoaded(false)
    setBills([])
    setLoadError('')
    try {
      const response = await fetch(`/api/homes/${encodeURIComponent(homeId.trim())}/bills`)
      const result = (await response.json()) as { bills?: Bill[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not load bills')
      if (!Array.isArray(result.bills)) throw new Error('Invalid bills response')
      setBills(result.bills)
      setLoaded(true)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load bills')
    } finally {
      setLoading(false)
    }
  }

  async function payShare(billId: string, shareId: string) {
    const key = paymentKeys[shareId] ?? crypto.randomUUID()
    setPaymentKeys((current) => ({ ...current, [shareId]: key }))
    setErrors((current) => ({ ...current, [shareId]: '' }))
    setPaying(shareId)
    try {
      const response = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      })
      const result = (await response.json()) as { paidAt?: string; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Payment failed')
      if (typeof result.paidAt !== 'string') throw new Error('Invalid payment response')
      const paidAt = result.paidAt
      setBills((current) =>
        current.map((bill) => ({
          ...bill,
          shares: bill.shares.map((share) => (share.id === shareId ? { ...share, paidAt } : share)),
        })),
      )
      setPaymentKeys((current) => {
        const next = { ...current }
        delete next[shareId]
        return next
      })
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [shareId]: error instanceof Error ? error.message : 'Payment failed',
      }))
    } finally {
      setPaying(null)
    }
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '40px auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>Shared Bill Splitter</h1>
      <form onSubmit={loadBills}>
        <label htmlFor="home-id">Home ID </label>
        <input
          id="home-id"
          value={homeId}
          onChange={(event) => setHomeId(event.target.value)}
          required
        />{' '}
        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Load bills'}
        </button>
      </form>
      {loadError && <p role="alert">{loadError}</p>}
      {loading && <p>Loading bills…</p>}
      {!loading && loaded && bills.length === 0 && <p>No bills yet.</p>}
      {bills.map((bill) => (
        <section
          key={bill.id}
          style={{ border: '1px solid #ccc', borderRadius: 8, marginTop: 20, padding: 16 }}
        >
          <h2>{bill.title}</h2>
          <p>Total: {bill.totalCents} cents</p>
          <ul>
            {bill.shares.map((share) => (
              <li key={share.id} style={{ marginBottom: 10 }}>
                {share.memberName}: {share.amountCents} cents — {share.paidAt ? 'Paid' : 'Unpaid'}
                {!share.paidAt && (
                  <button
                    type="button"
                    disabled={paying !== null}
                    onClick={() => payShare(bill.id, share.id)}
                    style={{ marginLeft: 8 }}
                  >
                    {paying === share.id ? 'Paying…' : errors[share.id] ? 'Retry payment' : 'Pay'}
                  </button>
                )}
                {errors[share.id] && <p role="alert">{errors[share.id]}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
