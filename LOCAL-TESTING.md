# Local testing

This walkthrough creates a home, adds members, splits a bill between them, and
tests paying a share. All commands are for PowerShell.

## 1. Start the app

From the repository root, run:

```powershell
pnpm dev
```

Keep that terminal open. It starts the API at `http://localhost:8787` and the
web app (usually `http://localhost:5173`). In a second PowerShell terminal,
also from the repository root, set the API URL and check that the API is ready:

```powershell
$env:API_URL = "http://localhost:8787"
Invoke-RestMethod -Method Get -Uri "$($env:API_URL)/api/health"
```

The health check should return `status: ok`.

## 2. Create a home

```powershell
$createdHome = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/homes" `
  -ContentType "application/json" `
  -Body (@{ name = "Split test home" } | ConvertTo-Json)
$createdHome | Format-List
$homeId = $createdHome.id
```

Keep this PowerShell window open; the remaining commands use `$homeId`.

## 3. Add members

Add a few members, one at a time:

```powershell
$asha = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/homes/$homeId/members" `
  -ContentType "application/json" `
  -Body (@{ name = "Asha" } | ConvertTo-Json)
$ben = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/homes/$homeId/members" `
  -ContentType "application/json" `
  -Body (@{ name = "Ben" } | ConvertTo-Json)
$chitra = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/homes/$homeId/members" `
  -ContentType "application/json" `
  -Body (@{ name = "Chitra" } | ConvertTo-Json)

@($asha, $ben, $chitra) | Select-Object name, id | Format-Table
```

Member order matters when the total has leftover cents: extra cents go to
members in the order they were added.

## 4. Create and split a bill

Money is entered as whole cents, not dollars. For example, `$10.00` is `1000`
cents. This creates a $10 bill and splits it three ways:

```powershell
$bill = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/homes/$homeId/bills" `
  -ContentType "application/json" `
  -Body (@{ title = "Lunch"; totalCents = 1000 } | ConvertTo-Json)

$bill | Select-Object id, title, totalCents | Format-List
$bill.shares | Select-Object id, memberId, amountCents, paidAt | Format-Table
$billId = $bill.id
$shareId = $bill.shares[0].id
```

The shares should be `334`, `333`, and `333` cents (that is, `$3.34`, `$3.33`,
and `$3.33`), adding up to exactly 1000 cents. Save `$billId` and `$shareId`
for the payment steps below.

## 5. Pay a share and test idempotency

A payment request needs an `Idempotency-Key` header. Generate one UUID and use
the **same key** if retrying the same payment attempt:

```powershell
$key = [guid]::NewGuid().ToString()
$key
$headers = @{ "Idempotency-Key" = $key }
$payment1 = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/bills/$billId/shares/$shareId/pay" `
  -Headers $headers
$payment2 = Invoke-RestMethod -Method Post `
  -Uri "$($env:API_URL)/api/bills/$billId/shares/$shareId/pay" `
  -Headers $headers

$payment1 | Format-List
$payment2 | Format-List
```

Both calls should succeed with the same `paidAt`. The second call is a retry:
the same share is not paid twice. A different key for this already-paid share
gets HTTP `409 Conflict`.

To see the updated bills and outstanding balances:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "$($env:API_URL)/api/homes/$homeId/bills" |
  ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Get `
  -Uri "$($env:API_URL)/api/homes/$homeId/balances" |
  ConvertTo-Json -Depth 6
```

## 6. Try it in the web app

Open the web URL printed by `pnpm dev`, usually `http://localhost:5173`. Enter
the Home ID shown by `$createdHome.id`, select **Load bills**, then select **Pay** on
an unpaid share.

## How the idempotency key works

- The web app creates a key with `crypto.randomUUID()` the first time you click
  **Pay** for a share. It looks like a UUID, for example
  `550e8400-e29b-41d4-a716-446655440000` (your key will be different).
- The browser keeps that key in React state associated with the share. If the
  request fails and you retry while the page is still open, it reuses the same
  key. After a successful response it clears the in-memory key.
- The API reads the key from the `Idempotency-Key` request header and stores it
  as `payment_key` on that share's row in the local D1 database, together with
  `paid_at`.
- On a repeated request, the API compares the incoming key with the stored key:
  a match returns the existing payment result (`200`); a different key returns
  `409`. A missing key returns `400`.

The key is a request identifier, not a secret or a password. The database keeps
the successful payment's key so a retry can safely receive the original result.

To start over with a fresh example, repeat steps 2–5 with a new home. The data
is stored in the local Wrangler D1 database.
