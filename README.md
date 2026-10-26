# ErrandCONNECT

Errands and delivery marketplace for Kenya: customers post errands, verified runners complete them, payments are held in escrow until delivery is confirmed.

## Repository layout

```
apps/
  api/            NestJS backend API (PostgreSQL via Prisma)
  mobile/         Expo (React Native) app for customers and runners
  admin/          Next.js admin panel for staff
packages/
  shared/         Code shared by every app: pricing engine, constants, geo helpers
docs/             Architecture, data model, pricing and roadmap notes
```

## Requirements

- Node.js 22+ and npm 11+ (`npm install -g npm@11`)
- Docker (for PostgreSQL + Redis), or your own PostgreSQL 16 and Redis 7
- For the mobile app on a phone: the Expo Go app

## Getting started

```bash
npm install
docker compose up -d                      # PostgreSQL + Redis
docker compose exec postgres createdb -U errand errandconnect_test   # for e2e tests
cp apps/api/.env.example apps/api/.env
npm run build -w @errandconnect/shared
npm run db:migrate                        # create tables
npm run db:seed                           # categories, platform wallets, default pricing
npm run dev:api                           # http://localhost:3000
```

Try it:

```bash
curl localhost:3000/health
curl -X POST localhost:3000/pricing/quote -H 'content-type: application/json' \
  -d '{"errandFee":2000,"distanceKm":2,"deliveryType":"MOTORCYCLE"}'
```

## Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # set EXPO_PUBLIC_API_URL
npm run dev:mobile                               # then press a (Android), i (iOS) or w (web)
```

To try it on your phone, install **Expo Go**, make sure the phone and computer are on the same Wi-Fi, set
`EXPO_PUBLIC_API_URL` to your computer's local IP (e.g. `http://192.168.1.20:3000`), and scan the QR code.
SMS codes appear in the API's console until an SMS provider is connected.

## Admin panel

```bash
cp apps/admin/.env.example apps/admin/.env.local   # NEXT_PUBLIC_API_URL
npm run dev:admin                                  # http://localhost:3001
```

Sign in with a staff account. Create the first one with `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD` and `npm run db:seed`, then add other staff from the **Staff** page (they must sign up in the app first). Each role only sees the pages it needs.

## Tests

```bash
npm test                                  # unit tests (all packages)
npm run test:e2e -w @errandconnect/api    # API tests against the errandconnect_test database
```

## Docs

- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA-MODEL.md)
- [Pricing](docs/PRICING.md)
- [API reference](docs/API.md)
- [Payments & escrow](docs/PAYMENTS.md)
