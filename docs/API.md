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
| GET | `/admin/audit-logs?entityType=&entityId=` | Super admin only |

The first super admin is created by `npm run db:seed` when `SEED_ADMIN_PHONE` and `SEED_ADMIN_PASSWORD` are set.

## Public

`GET /health`, `POST /pricing/quote`, `GET /categories`.
