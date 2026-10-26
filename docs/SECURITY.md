# Security

Summary of the security review done in Phase 8, the protections in place, and known issues. Re-check before each release.

## Protections

**Accounts and sessions**

- Passwords and PINs hashed with scrypt; constant-time comparisons; login locks for 15 minutes after repeated failures; same error for unknown phone and wrong password.
- Short-lived access tokens (15 min) and refresh tokens that rotate on every use (a stolen refresh token works once). Sessions can be revoked; suspended or deleted accounts are signed out.
- The admin panel keeps its refresh token in an **httpOnly, SameSite=Strict cookie** limited to `/auth`, so page scripts can't read it. The access token lives only in memory.
- **Staff two-factor sign-in** (authenticator app, RFC 6238): required for every staff member in production before any admin route works. Secrets encrypted with AES-256-GCM; each code works once; 10 one-time recovery codes; super admins can reset it (which signs the person out everywhere).
- Role-based access on every admin route; audit log of every important admin action.

**API**

- Every input is validated and unknown fields are rejected; JSON bodies limited to 200 KB; uploads limited to 5 MB and checked by file content, stored under random private names.
- Rate limits (stricter on login and OTP routes); real client IPs behind a proxy (`TRUST_PROXY`).
- Security headers (`nosniff`, `frame-ancestors 'none'`, HSTS in production, no `X-Powered-By`); CORS limited to listed origins.
- Errors never leak stack traces; each has a request ID.
- Startup refuses missing, weak, example or reused secrets in production.

**Money**

- Double-entry ledger where every transaction balances; idempotent M-Pesa callbacks; callback URLs contain a secret (which is masked in logs); escrow released only with the customer's PIN; withdrawals need the PIN, and big ones (or anyone with an open high-risk flag) need finance approval.

**Admin panel**

- Content-Security-Policy limiting connections to the API and map tiles, `X-Frame-Options: DENY`, no referrer leaks.

**Privacy (Kenya Data Protection Act 2019)**

- People can download all their data (`GET /me/export`) and delete their account (`POST /me/delete`) from the app. Deletion erases personal details, documents and payout details; records of errands and payments are kept without personal details, as financial records must be.
- Phone numbers are shown to the other party only while an errand is in progress.

## Known issues and accepted risks

| Issue                                                                                                                                                                                                                                                                                                                        | Status                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `npm audit` reports `node-forge` and an old `zod` inside Expo's command-line tool (`@expo/cli`). They are used only on developer machines/build servers on our own config, are not in the API, admin panel or the app shipped to users, and have no fixed version compatible with Expo 58 (npm's suggestion is a downgrade). | Accepted; re-check when Expo updates                |
| A promo code with a total-use limit can be used one or two times over the limit if several people apply it at the same instant.                                                                                                                                                                                              | Accepted (small cost)                               |
| The shared-network promo rule can flag people on the same mobile network (carrier NAT).                                                                                                                                                                                                                                      | It's a hint for staff, never an automatic block     |
| Uploaded documents are on local disk.                                                                                                                                                                                                                                                                                        | Move to encrypted object storage before scaling out |

## Reporting a vulnerability

Email security@errandconnect.co.ke (set this up before launch). Please don't test against production with real customer data.
