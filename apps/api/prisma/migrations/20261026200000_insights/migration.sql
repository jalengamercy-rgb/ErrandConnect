-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskFlagStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_distance_km" DOUBLE PRECISION,
ADD COLUMN     "predicted_minutes" INTEGER;

-- CreateTable
CREATE TABLE "risk_flags" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "status" "RiskFlagStatus" NOT NULL DEFAULT 'OPEN',
    "score" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "user_id" TEXT,
    "order_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_flags_dedupe_key_key" ON "risk_flags"("dedupe_key");

-- CreateIndex
CREATE INDEX "risk_flags_status_score_idx" ON "risk_flags"("status", "score");

-- CreateIndex
CREATE INDEX "risk_flags_user_id_idx" ON "risk_flags"("user_id");

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

