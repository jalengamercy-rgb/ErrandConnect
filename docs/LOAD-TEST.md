# Load test

`apps/api/scripts/load-test.mjs` signs up a customer and an online runner through the real API, then sends 50 concurrent connections at each endpoint for 20 seconds.

```bash
cd apps/api
npm run build
NODE_ENV=test LOG_REQUESTS=false PORT=3100 node dist/main.js   # test database; rate limits are off in test mode
node scripts/load-test.mjs http://localhost:3100 20
```

## Results (26 Oct 2026)

One API process (Node.js is single-threaded) and PostgreSQL on the same 4-core, 15 GB machine; 169 open errands in the area.

| Endpoint                                          | Requests/s | Median (ms) | 99th percentile (ms) | Errors |
| ------------------------------------------------- | ---------- | ----------- | -------------------- | ------ |
| GET /health (database ping)                       | 2,838      | 16          | 38                   | 0      |
| GET /categories                                   | 2,125      | 21          | 43                   | 0      |
| POST /orders/quote (pricing, surge, promo checks) | 468        | 104         | 149                  | 0      |
| GET /merchants (shop directory)                   | 499        | 96          | 138                  | 0      |
| GET /orders (customer's errands)                  | 526        | 89          | 164                  | 0      |
| GET /runners/me/jobs (nearby jobs)                | 229        | 209         | 299                  | 0      |

**What it means:** even the slowest common request (a runner refreshing jobs) handles over 200 per second on one process. A pilot with a few thousand active users makes a few requests per second at peak, so there is plenty of headroom; add API instances (see DEPLOYMENT.md) long before this becomes a limit.

**Fixed because of this test:**

- The job list used to fetch the 200 _oldest_ open errands in the whole city and then filter by distance, so in a busy city a runner could miss jobs right next to them. It now filters by area in the database, prefers newer errands, and loads only the fields the list needs (more than twice as fast: 97 → 229 requests/s).
- Pricing and growth settings are cached for 30 seconds instead of read on every quote (343 → 468 requests/s).
