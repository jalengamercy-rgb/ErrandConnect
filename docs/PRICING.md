# Pricing

Implemented in [`packages/shared/src/pricing.ts`](../packages/shared/src/pricing.ts). Settings are stored in `platform_settings` under key `pricing` and will be editable from the admin panel.

## What the customer pays

| Line | Rule | Who gets it |
|---|---|---|
| Items cost | Goods bought for the customer | Runner (reimbursed, no commission) |
| Errand fee | Price of the runner's service | Runner, minus commission (default 15%) |
| Delivery fee | Base fee covering first N km + per extra km (by vehicle type) | Runner 80%, platform 20% |
| Urgency fee | 1 h / 30 min / 15 min premium | Runner 70%, platform 30% |
| Service fee | KES 30 below 1,000, 50 below 5,000, else 100 (covers escrow) | Platform |

Rule: `customer total = runner total + platform total`, always (tested). The platform's share is rounded to the nearest shilling and the runner receives the exact remainder.

## Example (from the business plan)

KES 2,000 errand, motorcycle, 2 km:

| | KES |
|---|---|
| Errand | 2,000 |
| Delivery | 200 |
| Service fee | 50 |
| **Customer pays** | **2,250** |
| Runner: errand 1,700 + delivery 160 | 1,860 |
| Platform: commission 300 + delivery margin 40 + service fee 50 | 390 |

All default values are placeholders until the business sets real prices.
