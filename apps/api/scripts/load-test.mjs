/**
 * Load test for the main read paths. Run against a NON-production API that
 * uses the test database and simulated M-Pesa, e.g.:
 *
 *   NODE_ENV=test LOG_REQUESTS=false node dist/main.js        (rate limits are off in test mode)
 *   node scripts/load-test.mjs http://localhost:3000 30       (URL, seconds per scenario)
 *
 * It signs up a customer and an online runner through the API, then hits each
 * endpoint with 50 concurrent connections and prints latency and throughput.
 */
import autocannon from 'autocannon';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SECONDS = Number(process.argv[3] ?? 20);
const CONNECTIONS = 50;
const CBD = { lat: -1.2864, lng: 36.8172 };
const env = Object.fromEntries(
  readFileSync(new URL('../.env.test', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL.replace('?schema=public', '') });

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
}

const scenarios = (customer, runner) => [
  { title: 'GET /health (database ping)', path: '/health' },
  { title: 'GET /categories', path: '/categories' },
  {
    title: 'POST /orders/quote (pricing, surge, promo checks)',
    method: 'POST',
    path: '/orders/quote',
    token: customer,
    body: { categorySlug: 'parcel-delivery', pickup: { address: 'Kenyatta Avenue', ...CBD }, dropoff: { address: 'Westlands', lat: -1.2676, lng: 36.8108 }, deliveryType: 'MOTORCYCLE' },
  },
  { title: 'GET /merchants (shop directory near the CBD)', path: `/merchants?lat=${CBD.lat}&lng=${CBD.lng}`, token: customer },
  { title: 'GET /orders (customer errands)', path: '/orders?scope=past', token: customer },
  { title: 'GET /runners/me/jobs (nearby jobs for a runner)', path: '/runners/me/jobs', token: runner },
];

function run({ title, method = 'GET', path, token, body }) {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: BASE + path,
        method,
        connections: CONNECTIONS,
        duration: SECONDS,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body && JSON.stringify(body),
      },
      (error, result) => (error ? reject(error) : resolve({ title, result })),
    );
  });
}

await db.connect();
const { tokens: customerTokens } = await registerViaApi('CUSTOMER');
const { tokens: runnerTokens, user: runnerUser } = await registerViaApi('RUNNER');
await db.query(
  `UPDATE runner_profiles SET application_status='APPROVED', approved_at=now(), is_online=true, last_lat=$1, last_lng=$2, last_seen_at=now(),
     delivery_types='{MOTORCYCLE}', services_offered=(SELECT array_agg(slug) FROM service_categories) WHERE user_id=$3`,
  [CBD.lat, CBD.lng, runnerUser.id],
);

const rows = [];
for (const scenario of scenarios(customerTokens.accessToken, runnerTokens.accessToken)) {
  const { title, result } = await run(scenario);
  const errors = result.errors + result.non2xx;
  rows.push({ title, rps: Math.round(result.requests.average), p50: result.latency.p50, p99: result.latency.p99, errors });
  console.log(`${title}: ${Math.round(result.requests.average)} req/s, p50 ${result.latency.p50} ms, p99 ${result.latency.p99} ms, errors ${errors}`);
}
await db.end();
console.log('\n| Endpoint | Requests/s | Median (ms) | 99th percentile (ms) | Errors |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.title} | ${r.rps} | ${r.p50} | ${r.p99} | ${r.errors} |`);

/** Signs up through the real endpoints. The SMS isn't sent in test mode, so the stored code is set to a known one (test database only). */
async function registerViaApi(accountType) {
  const phone = `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await call('POST', '/auth/otp/request', { phone, purpose: 'REGISTER' });
  const hash = createHmac('sha256', env.OTP_SECRET).update(`${phone}:REGISTER:123456`).digest('hex');
  await db.query('UPDATE otp_codes SET code_hash = $1 WHERE destination = $2', [hash, phone]);
  const { verificationToken } = await call('POST', '/auth/otp/verify', { phone, purpose: 'REGISTER', code: '123456' });
  return call('POST', '/auth/register', {
    verificationToken,
    accountType,
    firstName: 'Load',
    lastName: 'Test',
    password: 'Secret123',
    pin: '4821',
    acceptTerms: true,
    acceptPrivacy: true,
  });
}
