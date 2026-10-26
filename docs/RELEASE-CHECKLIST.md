# Release checklist

Things to do before real customers and real money. Code items are done; the rest needs people, accounts and paperwork.

## Legal and compliance (Kenya)

- [ ] Register as a data controller/processor with the **Office of the Data Protection Commissioner (ODPC)**.
- [ ] Have a lawyer finish the **privacy policy** and **terms** (drafts in `docs/legal/`) and publish them at public URLs (needed by both app stores).
- [ ] Confirm how customer money is held (escrow/trust account with a bank or licensed payment provider) with the Central Bank of Kenya rules in mind.
- [ ] Business registration and KRA PIN; agree record-keeping (financial records are kept after account deletion).

## Accounts and keys

- [ ] **Safaricom Daraja**: production go-live for STK Push (Paybill/Till) and B2C (withdrawals); set the production credentials and callback URLs.
- [ ] **SMS provider** (e.g. Africa's Talking) with a registered sender ID; connect it in `MessagingService` (development logs codes instead of sending).
- [ ] **Google Play Console** (one-time fee) and **Apple Developer Program** (yearly) accounts; Expo account for EAS builds.
- [ ] Domain, DNS, and a `security@` email address.

## Infrastructure

- [ ] Server and production `.env` (DEPLOYMENT.md); secrets stored in a password manager, not in chat or email.
- [ ] Daily database backups copied off the server, and one **test restore**.
- [ ] Log collection and an alert on errors / failed M-Pesa callbacks; uptime check on `/health`.
- [ ] First super admin created; every staff member has set up two-factor sign-in.

## Mobile app

- [ ] Replace placeholder icon and splash with the final brand assets.
- [ ] Set the production API URL in `apps/mobile/eas.json` (production profile).
- [ ] `eas build --platform android --profile production` and `eas build --platform ios --profile production`; test on real low-end Android phones (most Kenyan users).
- [ ] Store listings: screenshots, description, category, contact email, privacy policy URL, **data safety** (Play) / **privacy nutrition labels** (Apple): phone, name, location, photos (ID documents), payment info.
- [ ] Explain account deletion in the listing (Profile → Privacy & account → Delete my account); Google Play also requires a web link for deletion requests.
- [ ] `eas submit` to the internal test track, then a closed test with a few runners and customers.

## Pilot

- [ ] Start in a few Nairobi areas with a small group of verified runners (ROADMAP: Pilot).
- [ ] Set real prices and fees (Pricing & categories), referral and loyalty amounts (Rewards & Plus); keep surge off until there is demand data.
- [ ] Watch the Insights page daily: risk flags, late errands, areas short of runners.
