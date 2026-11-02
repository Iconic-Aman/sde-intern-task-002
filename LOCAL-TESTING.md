# Local testing

## 1. Start the app

From the repository root, start the API and web app:

```powershell
pnpm dev
```

Keep this terminal running. In a second PowerShell terminal, go to the
repository root and run the commands below in the same session.

## 2. Create a home and add three members in order

```powershell
$env:API_URL = "http://localhost:8787"
$createdHome = Invoke-RestMethod -Method Post -Uri "$($env:API_URL)/api/homes" -ContentType "application/json" -Body (@{ name = "Split test home" } | ConvertTo-Json)
$homeId = $createdHome.id
if (-not $homeId) { throw "Home creation did not return an ID." }
Write-Host "Home ID: $homeId"

$asha = Invoke-RestMethod -Method Post -Uri "$($env:API_URL)/api/homes/$homeId/members" -ContentType "application/json" -Body (@{ name = "Asha" } | ConvertTo-Json)
$ben = Invoke-RestMethod -Method Post -Uri "$($env:API_URL)/api/homes/$homeId/members" -ContentType "application/json" -Body (@{ name = "Ben" } | ConvertTo-Json)
$chitra = Invoke-RestMethod -Method Post -Uri "$($env:API_URL)/api/homes/$homeId/members" -ContentType "application/json" -Body (@{ name = "Chitra" } | ConvertTo-Json)
```

The members are added one at a time; this order determines who gets any extra
cents.

## 3. Create and verify an uneven bill

```powershell
$bill = Invoke-RestMethod -Method Post -Uri "$($env:API_URL)/api/homes/$homeId/bills" -ContentType "application/json" -Body (@{ title = "Uneven test bill"; totalCents = 1000 } | ConvertTo-Json)
$bill.shares | Select-Object memberId, amountCents, paidAt | Format-Table
```

The shares should be **334, 333, 333** in member order. They add up to 1000
cents; the first member gets the extra cent.

## 4. Verify the page and payment

Open the web address printed by `pnpm dev` in your browser. Enter the Home ID
printed above and select **Load bills**. The page should show the bill and
shares by member name. Select **Pay** on an unpaid share; it should change to
Paid. If payment fails, the share should remain Unpaid and show an error.

To inspect the API response directly:

```powershell
Invoke-RestMethod -Method Get -Uri "$($env:API_URL)/api/homes/$homeId/bills" | ConvertTo-Json -Depth 6
```

Repeat from step 2 to create a fresh test home and bill.
