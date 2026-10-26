# Data model

Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## Identity
- **users** – one row per person (phone is the login). Roles are separate profile tables, so one person can be customer *and* runner.
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
- **merchants** + **merchant_members** – shops/restaurants.

## Orders
- **service_categories** – errand types (seeded).
- **orders** – errand details, address snapshots, full price breakdown + pricing snapshot, delivery PIN hash.
- **order_events** – status timeline.
- **reviews** – ratings for runners, customers, merchants.

## Money
- **payments** – incoming money from M-Pesa/cards with raw callbacks.
- **wallets** – customer, runner, merchant, business, plus platform wallets (revenue, escrow, external clearing).
- **ledger_transactions** / **ledger_entries** – double-entry records; entries in a transaction sum to zero.
- **escrows** – money held per order until delivery is confirmed.
- **withdrawals** – payout requests and their approval status.

## Admin
- **platform_settings** – admin-editable JSON settings (e.g. `pricing`).
- **audit_logs** – every important admin/system action.

Tables for disputes, support tickets, promotions, subscriptions and ads are added in their phases.
