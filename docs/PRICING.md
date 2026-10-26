# Pricing

Implemented in [`packages/shared/src/pricing.ts`](../packages/shared/src/pricing.ts). Settings are stored in `platform_settings` under key `pricing` and will be editable from the admin panel.

## What the customer pays

| Line           | Rule                                                                                                                    | Who gets it                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Items cost     | Goods bought for the customer                                                                                           | Runner (reimbursed, no commission)                                |
| Errand fee     | Price of the runner's service                                                                                           | Runner, minus commission (default 15%)                            |
| Delivery fee   | Base fee covering first N km + per extra km (by vehicle type)                                                           | Runner 80%, platform 20%                                          |
| Urgency fee    | 1 h / 30 min / 15 min premium                                                                                           | Runner 70%, platform 30%                                          |
| Service fee    | KES 30 below 1,000, 50 below 5,000, else 100 (covers escrow). Waived for ErrandCONNECT Plus members (personal errands). | Platform                                                          |
| Surge fee      | Delivery fee × (multiplier − 1) when it's busy. Off by default.                                                         | Runner 80%, platform 20%                                          |
| Promo discount | From a promo code, on fees only (never on items)                                                                        | Paid by the platform; capped so the runner is always paid in full |

Rule: `customer total = runner total + platform total`, always (tested). The platform's share is rounded to the nearest shilling and the runner receives the exact remainder.

## Surge pricing

Off until operations switch it on (Pricing & categories in the admin panel). Within `radiusKm` of where the errand starts, open errands from the last hour are compared with runners online in the last 10 minutes:

- runners keep up (errands ≤ runners): ×1
- each extra errand per runner adds 25%, e.g. 10 errands / 5 runners = ×1.25 → ×1.3 (rounded to 0.1)
- no runners nearby but errands waiting: the maximum
- never above `maxMultiplier`, never below `manualMultiplier` (for heavy rain, holidays…)

Runners see the surge part of their pay as a "busy-time bonus" on the job.

## Example (from the business plan)

KES 2,000 errand, motorcycle, 2 km:

|                                                                | KES       |
| -------------------------------------------------------------- | --------- |
| Errand                                                         | 2,000     |
| Delivery                                                       | 200       |
| Service fee                                                    | 50        |
| **Customer pays**                                              | **2,250** |
| Runner: errand 1,700 + delivery 160                            | 1,860     |
| Platform: commission 300 + delivery margin 40 + service fee 50 | 390       |

All default values are placeholders until the business sets real prices.
