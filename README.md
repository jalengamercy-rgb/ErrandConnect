# ErrandCONNECT

Errands and delivery marketplace for Kenya: customers post errands, verified runners complete them, payments are held in escrow until delivery is confirmed.

## Repository layout

```
apps/
  api/            NestJS backend API (PostgreSQL via Prisma)
packages/
  shared/         Code shared by every app: pricing engine, constants, geo helpers
docs/             Architecture, data model, pricing and roadmap notes
```

Coming in later phases: `apps/mobile` (Expo customer + runner app) and `apps/admin` (Next.js admin panel).

## Requirements

- Node.js 22+ and npm 11+ (`npm install -g npm@11`)
- Docker (for PostgreSQL + Redis), or your own PostgreSQL 16 and Redis 7

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
