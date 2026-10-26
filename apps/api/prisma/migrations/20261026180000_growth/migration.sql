-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('ORDERS', 'COMMISSION', 'FEATURED_LISTING');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BannerAudience" AS ENUM ('ALL', 'CUSTOMERS', 'RUNNERS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerTransactionType" ADD VALUE 'MERCHANT_COMMISSION';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'SUBSCRIPTION';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'FEATURED_LISTING';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'ADVERTISING';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'REFERRAL_REWARD';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'LOYALTY_REDEMPTION';

-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "lifetime_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyalty_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "featured_weeks" INTEGER,
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'ORDERS';

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "featured_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "surge_fee" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "subscription_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referral_rewarded_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "PromoType" NOT NULL,
    "value" INTEGER NOT NULL,
    "max_discount" INTEGER,
    "min_order_value" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" TEXT NOT NULL,
    "promo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "price" INTEGER NOT NULL,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "merchant_id" TEXT,
    "category_slug" TEXT,
    "url" TEXT,
    "audience" "BannerAudience" NOT NULL DEFAULT 'CUSTOMERS',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "advertiser" TEXT,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_order_id_key" ON "promo_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_id_user_id_idx" ON "promo_redemptions"("promo_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_events_order_id_key" ON "loyalty_events"("order_id");

-- CreateIndex
CREATE INDEX "loyalty_events_user_id_created_at_idx" ON "loyalty_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "banners_is_active_starts_at_idx" ON "banners"("is_active", "starts_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_events" ADD CONSTRAINT "loyalty_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

