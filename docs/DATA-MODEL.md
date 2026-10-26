# Data model

Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## Identity

- **users** – one row per person (phone is the login). Roles are separate profile tables, so one person can be customer _and_ runner.
- **otp_codes** – hashed one-time codes for login/registration.
- **sessions** – logged-in devices (refresh tokens, hashed).
- **consents** – Terms/Privacy/GPS agreements with version and timestamp.
- **emergency_contacts**, **addresses** (saved places with GPS).

## Profiles

- **customer_profiles** – verification level (1 phone, 2 email, 3 ID), preferences.
- **runner_profiles** – the 15-step registration data, onboarding progress, verification tracker timestamps, online status and last location, rating.
- **vehicles**, **documents** (uploaded IDs/licences with admin review status), **payout_methods**.
- **staff_profiles** – admin roles (Super Admin, Finance Manager...).

## Organisations

- **businesses** + **business_members** – company accounts, teams, credit limit, approval limits.
- **merchants** + **merchant_members** – shops/restaurants, commission rate, featured flag.
- **invoices** – monthly bills: company invoices cover `BUSINESS_INVOICE` order totals (`orders.invoice_id`); shop invoices cover commission (`orders.merchant_invoice_id`).

## Orders

- **service_categories** – errand types (seeded).
- **orders** – errand details, address snapshots, full price breakdown + pricing snapshot, delivery PIN hash; optional `business_id` (billed company, `approved_by_id`) and `merchant_id` (shop, `merchant_commission`, `merchant_ready_at`).
- **order_events** – status timeline.
- **reviews** – ratings for runners, customers, merchants.

## Money

- **payments** – incoming money from M-Pesa/cards with raw callbacks.
- **wallets** – customer, runner, merchant, business, plus platform wallets (revenue, escrow, external clearing).
- **ledger_transactions** / **ledger_entries** – double-entry records; entries in a transaction sum to zero.
- **escrows** – money held per order until delivery is confirmed.
- **withdrawals** – payout requests and their approval status.

## Growth

- **promo_codes** + **promo_redemptions** – discount codes and which order used them (uses on cancelled orders don't count).
- **subscriptions** – ErrandCONNECT Plus, one row per user extended each paid 30-day period; `payments.subscription_id` for M-Pesa payments.
- **loyalty_events** – points earned per completed order (unique per order) and redeemed; balances on `customer_profiles.loyalty_points` / `lifetime_points`.
- **banners** – home-screen promotions and ads with impressions, clicks and ad payments received.
- `users.referral_rewarded_at` – referral rewards paid (once); `merchants.featured_until` – paid featured placement; `invoices.kind` – ORDERS, COMMISSION or FEATURED_LISTING; `orders.surge_fee`, `orders.discount`.

## Admin

- **platform_settings** – admin-editable JSON settings (`pricing`, `growth`).
- **audit_logs** – every important admin/system action.

Tables for disputes, support tickets, promotions, subscriptions and ads are added in their phases.
