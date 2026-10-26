# Payments, escrow and wallets

## How money moves

Every movement is a balanced double-entry booking (`ledger_transactions` / `ledger_entries`); the sum of all wallet balances is always zero (checked after every payments test).

| Event | Booking |
|---|---|
| Customer pays with M-Pesa | `EXTERNAL_CLEARING` → `ESCROW` |
| Customer pays from wallet | customer wallet → `ESCROW` |
| Delivery PIN confirmed | `ESCROW` → runner wallet (`runnerEarnings`) + `PLATFORM_REVENUE` (`platformFee`) |
| Cancelled after paying | `ESCROW` → customer wallet (full refund) |
| Paid after cancelling, or paid too little | `ESCROW` → customer wallet |
| Cash errand completed | runner wallet → `PLATFORM_REVENUE` (fee the runner owes; wallet may go negative) |
| Withdrawal requested | user wallet → `PAYOUT_PENDING` |
| Withdrawal paid | `PAYOUT_PENDING` → `EXTERNAL_CLEARING` |
| Withdrawal failed / rejected | `PAYOUT_PENDING` → user wallet |

`EXTERNAL_CLEARING` mirrors the M-Pesa account: its balance is the negative of the money M-Pesa holds for the business.

## Rules

- M-Pesa errands stay `AWAITING_PAYMENT` (hidden from runners) until Safaricom confirms. Customers can resend the prompt (30 s cooldown) or cancel.
- Runners owing more than KES 1,000 in cash-errand fees can't accept cash jobs; M-Pesa earnings clear the debt.
- Withdrawals: KES 100 – 150,000, security PIN required. Up to KES 5,000 is paid automatically; above that needs a Finance Manager. Runners can only withdraw to their approved payout account; customers only to their own number. Bank withdrawals are paid manually and marked paid by finance.
- Every callback and booking is idempotent: Safaricom repeating a callback never pays twice.

## Simulated vs real M-Pesa

`MPESA_MODE=fake` (default outside production) simulates M-Pesa: payments and payouts confirm automatically after 3 seconds. No real money moves.

To use Safaricom:
1. Create an app on the [Daraja portal](https://developer.safaricom.co.ke) and enable **Lipa na M-Pesa Online** and **B2C**.
2. Set in `apps/api/.env`: `MPESA_MODE=daraja`, `MPESA_ENV=sandbox`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE_URL` (a public HTTPS URL of the API — for local testing use a tunnel such as ngrok), `MPESA_CALLBACK_SECRET` (random), and for withdrawals `MPESA_B2C_SHORTCODE`, `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL`.
3. Test in the sandbox, then switch `MPESA_ENV=production` with go-live credentials.

The Daraja request formats follow Safaricom's documentation and are unit-tested, but must be confirmed against the live sandbox once credentials exist. In production, also restrict the callback URLs to Safaricom's IP addresses.

## Before handling real money

Holding customer funds may require Central Bank of Kenya approval or a licensed partner/trust account. Get legal advice before going live.
