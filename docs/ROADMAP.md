# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0. Foundation | Monorepo, database schema, pricing engine, API skeleton | Done |
| 1. Accounts & onboarding | Phone OTP login, customer registration, runner 15-step registration, document uploads, admin approval | API done; app screens next |
| 2. Core errand flow (MVP) | Create errand, quote, runner matching, order statuses, live tracking, chat, ratings | |
| 3. Payments & escrow | M-Pesa STK Push, escrow hold/release with delivery PIN, wallets, B2C withdrawals, refunds | |
| Pilot | Small launch in a few Nairobi areas | |
| 4. Admin panel | Dashboard, live map, order/escrow/payment management, disputes, tickets, reports, roles, audit logs | |
| 5. Merchants & businesses | Merchant onboarding, business accounts, teams, invoicing, bulk/scheduled deliveries | |
| 6. Growth & revenue | Promos, referrals, loyalty, ErrandCONNECT Plus, featured listings, ads, surge pricing | |
| 7. AI insights | Fraud/risk rules first, then demand, delay and churn prediction once data exists | |
| 8. Hardening & release | Security review, load testing, Play Store / App Store | |

## Non-code prerequisites

- **Escrow licensing:** holding customer funds may fall under Central Bank of Kenya rules. Get legal advice before Phase 3; plan to use a licensed provider / trust account.
- **Data protection:** register with the ODPC and publish a privacy policy before collecting IDs and GPS data from real users (Data Protection Act 2019).
- **Accounts needed:** Safaricom Daraja (M-Pesa), Google Maps Platform, Africa's Talking (SMS). All have sandbox modes for development.
