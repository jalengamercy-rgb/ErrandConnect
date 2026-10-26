# Architecture

```
 Customer app ─┐                       ┌─ PostgreSQL (data, ledger)
 Runner app  ──┼──▶  NestJS API  ──────┼─ Redis (real-time, queues)
 Admin panel ──┘   (REST + WebSocket)  ├─ Object storage (ID documents, photos)
                                       └─ M-Pesa Daraja, Google Maps, Africa's Talking
```

| Part | Technology | Why |
|---|---|---|
| Mobile apps | React Native (Expo) | One codebase for Android and iOS |
| Admin panel | Next.js | Fast web dashboard, shares TypeScript types |
| API | NestJS 12 (ES modules) | Structured modules, dependency injection, validation |
| Database | PostgreSQL 16 + Prisma 7 | Reliable transactions for money; typed queries |
| Real-time | Socket.IO + Redis | Live tracking, job offers, chat |

## Key decisions

- **One language everywhere (TypeScript).** The pricing engine in `packages/shared` runs identically on phones, API and admin.
- **Money is whole shillings (`Int`).** Matches M-Pesa, avoids floating-point errors.
- **Double-entry ledger.** Every money movement is a `LedgerTransaction` whose entries sum to zero. Escrow, wallets and platform revenue are all wallets, so the books always balance and can be audited.
- **Idempotency keys** on ledger transactions so a repeated M-Pesa callback can never pay twice.
- **Snapshots.** Orders copy addresses and the pricing config used, so history never changes when settings or saved addresses change.
- **Consent records** store what each user agreed to and which version (Data Protection Act).
