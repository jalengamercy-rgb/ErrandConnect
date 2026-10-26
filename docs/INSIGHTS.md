# Insights: risk rules and predictions

Everything here is plain rules and statistics on ErrandCONNECT's own data, so staff can always see why a flag or number appears. No outside AI service is used and no customer data leaves the platform. The thresholds live in `packages/shared/src/insights.ts` (`RISK_LIMITS`) and are easy to tune as real data comes in; trained models can replace the simple ones later behind the same API.

## Risk rules

Checks run every hour (and on demand from the admin Insights page), plus instantly when an errand is placed or delivered. Each finding becomes a **risk flag** in a review queue. The same finding about the same person is raised at most once a week, so a dismissed flag stays dismissed.

| Rule                                  | When                                                                                                  | Severity      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------- |
| Cancels a lot after a runner accepts  | 5+ in 30 days                                                                                         | Medium        |
| Reports many problems                 | 3+ disputes in 30 days (5+ = high)                                                                    | Medium / High |
| Runner hands back many jobs           | 4+ in 7 days                                                                                          | Medium        |
| Wrong delivery PINs                   | 3+ wrong PINs on 2+ errands in 30 days                                                                | High          |
| Delivered far from the drop-off       | PIN entered more than 1 km away (3+ in 30 days = high)                                                | Medium / High |
| Runner rated poorly                   | Average below 3.0 from 5+ reviews                                                                     | Medium        |
| Many referral rewards                 | 5+ in 7 days                                                                                          | High          |
| Same promo code, same network         | 3+ new accounts using one code from one IP address. Mobile networks share IPs, so this is only a hint | Medium        |
| Many failed M-Pesa payments           | 5+ in 24 hours                                                                                        | Low           |
| Same runner and customer              | 5+ completed errands together in 7 days (possible collusion for rewards)                              | Medium        |
| Large first errand from a new account | KES 3,000+ within 24 hours of signing up                                                              | Low           |

What happens automatically: **only** that withdrawals from someone with an open **high** flag wait for finance approval instead of being paid at once. Everything else is for staff to judge: confirm (and suspend from the person's page if needed) or dismiss.

## Delivery time

For each vehicle type, a straight line `minutes = fixed time + minutes per km × trip distance` is fitted to completed errands from the last 60 days (accepted → completed, ignoring errands under 1 minute or over 6 hours). Until there are 10 errands for a vehicle type, typical Nairobi speeds are used (motorcycle 25 km/h, car 18 km/h…, plus 20 minutes for collecting).

- When a runner accepts, the prediction is saved on the errand and the customer sees **"Expected around 14:35"**.
- An errand is **running late** once it takes 30% (and at least 10 minutes) longer than predicted. Operations see these on the Insights page and the dashboard.

## Demand

The expected number of errands for each coming hour is the average for the same weekday and hour over the last 8 weeks, with recent weeks counting more (weights 1, ½, ⅓…). For the next 3 hours the same is done per ~2 km area, and compared with runners online there now (a runner handles about 1.5 errands an hour) to show **where runners are short**. Use it to message runners or plan incentives; surge pricing does the same automatically when enabled.

## Churn

- **Customers** are compared with their own rhythm: their usual gap between completed errands (at least 7 days; 14 if they've only had one). At risk after 2× the usual gap, likely lost after 4×, lost after 90 days. The list is sorted by lifetime spend.
- **Runners** who did 5+ jobs in the last 60 days but none in the last 14.

Marketing (customers) and runner managers (runners) can select people and send a win-back message to their app inbox, optionally with a promo code.
