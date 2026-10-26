# API reference

Base URL (local): `http://localhost:3000`. Send `Authorization: Bearer <accessToken>` on every route except those marked **public**. Phone numbers may be sent as `07…`, `01…`, `2547…` or `+2547…`; the API stores them as `+254…`.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/request` | **public**. `{ phone, purpose: REGISTER \| RESET_PASSWORD }`. 1 per minute, 5 per hour. |
| POST | `/auth/otp/verify` | **public**. `{ phone, purpose, code }` → `{ verificationToken }` (valid 15 min) |
| POST | `/auth/register` | **public**. `{ verificationToken, accountType: CUSTOMER \| RUNNER, firstName, lastName, password, pin, acceptTerms, acceptPrivacy, … }` → `{ user, tokens }` |
| POST | `/auth/login` | **public**. `{ phone, password }`. Locks for 15 min after 5 wrong passwords. |
| POST | `/auth/refresh` | **public**. `{ refreshToken }` → new tokens; the old refresh token stops working. |
| POST | `/auth/logout` | Ends the current session. |
| POST | `/auth/password/reset` | **public**. `{ verificationToken, newPassword }`; signs out all devices. |

## Me (any logged-in user)

| Method | Path | Notes |
|---|---|---|
| GET / PATCH | `/me` | Profile |
| PATCH | `/me/customer-preferences` | Customers: favourite categories, notifications, language |
| POST | `/me/roles/customer`, `/me/roles/runner` | Add the other account type |
| POST | `/me/email/verify/request`, `/me/email/verify/confirm` | Email OTP → verification level 2 |
| GET / POST | `/me/addresses` | Saved places; first one becomes default |
| PATCH / DELETE | `/me/addresses/:id` | |
| GET / PUT | `/me/emergency-contact` | |

## Documents

| Method | Path | Notes |
|---|---|---|
| POST | `/documents` | multipart: `type` + `file` (JPEG/PNG/WebP/PDF, max 5 MB) |
| GET | `/documents/mine` | |
| GET | `/documents/:id/file` | Owner or staff only |

## Runner onboarding (runner accounts)

`GET /runners/me/onboarding` returns `percentComplete`, `steps`, `missingRequired`, `canSubmit`, the verification `tracker`, and `answers` (saved values, for prefilling forms). Each `PUT` returns the same.

| Step | Route |
|---|---|
| 1 Basic information | `PUT /runners/me/onboarding/personal` |
| 2 Service area | `PUT /runners/me/onboarding/service-area` |
| 3 Delivery type | `PUT /runners/me/onboarding/delivery-types` |
| 4 Vehicles | `POST /runners/me/vehicles`, `PUT/DELETE /runners/me/vehicles/:id`, document `VEHICLE_PHOTO` |
| 5 Identity | documents `NATIONAL_ID_FRONT`, `NATIONAL_ID_BACK`, `SELFIE`, `SELFIE_WITH_ID`; `PUT …/identity` for KRA PIN |
| 6 Emergency contact | `PUT /me/emergency-contact` |
| 7 Payout | `PUT /runners/me/onboarding/payout` |
| 8 Work preferences | `PUT /runners/me/onboarding/work-preferences` |
| 9 Services | `PUT /runners/me/onboarding/services` |
| 10–12 Experience, equipment, skills (optional) | `PUT …/experience`, `…/equipment`, `…/skills` |
| 13 Background | `PUT /runners/me/onboarding/background` |
| 14 Security | done at sign-up |
| 15 Agreements | `PUT /runners/me/onboarding/agreements` |
| Submit | `POST /runners/me/onboarding/submit` |
| Online toggle | `PUT /runners/me/online` (approved runners only) |

## Errands

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/orders/quote` | Customer | `{ categorySlug, dropoffAddressId \| dropoff{address,lat,lng}, pickup?, deliveryType, urgency?, itemsCost? }` → price breakdown + `distanceKm` |
| POST | `/orders` | Customer | Same + `description`, `recipientName?`, `recipientPhone?`, `scheduledFor?`, `paymentMethod: MPESA \| WALLET \| CASH`, `mpesaPhone?`. Limited by verification level (L1 ≤ 5,000, L2 ≤ 20,000). M-Pesa orders start as `AWAITING_PAYMENT`. |
| POST | `/orders/:id/pay` `{ phone? }` | Customer | Send the M-Pesa prompt again |
| POST | `/orders/:id/payment/refresh` | Customer | Ask M-Pesa about a payment whose callback hasn't arrived |
| GET | `/orders?scope=active\|past` | Customer | Own errands |
| GET | `/orders/:id` | Customer, assigned runner, staff | `deliveryPin` only for the customer; phones only while in progress |
| POST | `/orders/:id/cancel` `{ reason }` | Customer | Until the runner has picked up |
| GET | `/runners/me/jobs` | Runner | Open jobs nearby matching delivery type, services and max distance; `runnerFee` is what they keep |
| POST | `/orders/:id/accept` | Runner | First runner wins; one active job at a time |
| POST | `/orders/:id/progress` `{ status: AT_STORE\|PICKED_UP\|IN_TRANSIT }` | Runner | Forward only |
| POST | `/orders/:id/deliver` `{ pin }` | Runner | Customer's PIN completes the order; locks after 5 wrong PINs |
| POST | `/orders/:id/release` `{ reason }` | Runner | Hand back before pickup |
| GET | `/runners/me/orders?scope=` | Runner | Jobs taken |
| PUT | `/runners/me/location` `{ lat, lng }` | Runner | Sent while online, for live tracking |
| GET / POST | `/orders/:id/messages` | Customer, runner | Chat (open until 24 h after the errand ends) |
| POST | `/orders/:id/review` `{ stars, comment? }` | Customer, runner | Once each, after completion |

## Wallets

| Method | Path | Notes |
|---|---|---|
| GET | `/wallets` | Customer/runner wallets with `balance` and `pendingWithdrawals` |
| GET | `/wallets/:type/transactions` | `type` = `customer` or `runner` |
| POST | `/wallets/:type/withdrawals` `{ amount, pin }` | Withdraw to M-Pesa (see docs/PAYMENTS.md) |
| GET | `/wallets/withdrawals` | Own withdrawals |

## Support & notifications

| Method | Path | Notes |
|---|---|---|
| POST | `/orders/:id/disputes` `{ type, description }` | Customer or runner reports a problem; order becomes `DISPUTED`, escrow `ON_HOLD` |
| POST / GET | `/support/tickets` | Open a ticket `{ subject, message, orderId? }` / list own tickets |
| GET | `/support/tickets/:id` | Conversation |
| POST | `/support/tickets/:id/messages` `{ message }` | Reply (reopens the ticket) |
| GET | `/me/notifications` | In-app inbox (latest 50) |
| POST | `/me/notifications/:id/read`, `/me/notifications/read-all` | Mark read |

## M-Pesa callbacks (called by Safaricom)

`POST /payments/mpesa/stk-callback/:secret`, `/b2c-result/:secret`, `/b2c-timeout/:secret`.

### Live updates (Socket.IO)

Connect with `io(API_URL, { auth: { token: accessToken } })`. Events: `job.new`, `job.taken`, `order.updated`, `order.message`, `runner.location`, `wallet.updated`, `notification.new`. Emit `order.subscribe { orderId }` to join an order's room.

## Admin (staff accounts)

| Method | Path | Roles (plus SUPER_ADMIN) |
|---|---|---|
| GET | `/admin/runners?status=&search=&page=` | Operations, Runner manager |
| GET | `/admin/runners/:id` | Operations, Runner manager |
| POST | `/admin/runners/:id/start-review` | Operations, Runner manager |
| POST | `/admin/runners/:id/checks` `{ check: IDENTITY\|VEHICLE\|BACKGROUND\|PAYOUT, passed }` | Operations, Runner manager |
| POST | `/admin/runners/:id/approve`, `/reject` `{ reason }` | Operations, Runner manager |
| POST | `/admin/documents/:id/review` `{ decision, reason? }` | Operations, Runner manager, Support |
| GET | `/admin/customers` | Operations, Support |
| POST | `/admin/customers/:id/verify-id` | Operations, Support |
| POST | `/admin/users/:id/suspend` `{ reason }`, `/activate` | Operations |
| GET | `/admin/orders?status=&search=` | Operations, Support |
| GET | `/admin/orders/:id` | Operations, Support |
| POST | `/admin/orders/:id/assign` `{ runnerId }` | Operations |
| POST | `/admin/orders/:id/cancel` `{ reason }` | Operations, Support |
| GET | `/admin/finance/summary` | Finance |
| GET | `/admin/escrows?status=` | Finance, Operations |
| GET | `/admin/payments?status=&search=` | Finance |
| GET | `/admin/withdrawals?status=` | Finance |
| POST | `/admin/withdrawals/:id/approve`, `/reject` `{ reason }`, `/mark-paid` `{ reference }` | Finance |
| GET | `/admin/dashboard` | Any staff |
| GET | `/admin/reports/daily?days=`, `/reports/categories`, `/reports/top-runners` | Operations, Finance, Marketing |
| GET | `/admin/reports/orders.csv?from=&to=` | Operations, Finance |
| GET | `/admin/live-map` | Operations, Runner manager, Support |
| GET / PUT | `/admin/settings/pricing` | Read: Finance, Operations · Write: Finance (validated, audited) |
| GET / POST / PATCH | `/admin/categories`, `/admin/categories/:slug` | Operations (Finance can edit fees) |
| GET | `/admin/reviews?maxStars=&hidden=` · POST `/admin/reviews/:id/visibility` `{ hidden }` | Support, Operations |
| GET | `/admin/customers/:id` | Operations, Support |
| POST | `/admin/notifications` `{ audience, title, body, sms? }` | Operations, Marketing |
| GET / POST | `/admin/disputes`, `/admin/disputes/:id`, `/admin/disputes/:id/resolve` `{ outcome, refundAmount?, resolution }` | Operations (Support can view) |
| GET / PATCH / POST | `/admin/tickets`, `/admin/tickets/:id`, `/admin/tickets/:id/messages` | Support, Operations |
| GET / POST / PATCH / DELETE | `/admin/staff`, `/admin/staff/:userId` | Super admin only |
| GET | `/admin/audit-logs?entityType=&entityId=` | Super admin only |

The first super admin is created by `npm run db:seed` when `SEED_ADMIN_PHONE` and `SEED_ADMIN_PASSWORD` are set.

## Public

`GET /health`, `POST /pricing/quote`, `GET /categories`.
