-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterEnum
ALTER TYPE "WalletType" ADD VALUE 'PAYOUT_PENDING';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "mpesa_phone" TEXT,
ADD COLUMN     "paid_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "provider_receipt" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_provider_reference_key" ON "withdrawals"("provider_reference");
