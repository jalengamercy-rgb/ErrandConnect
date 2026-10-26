/*
  Warnings:

  - You are about to drop the column `delivery_pin_hash` on the `orders` table. All the data in the column will be lost.
  - Added the required column `delivery_pin` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "orders" DROP COLUMN "delivery_pin_hash",
ADD COLUMN     "delivery_pin" TEXT NOT NULL,
ADD COLUMN     "pin_attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "service_categories" ADD COLUMN     "base_fee" INTEGER NOT NULL DEFAULT 150;

-- CreateTable
CREATE TABLE "order_messages" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_messages_order_id_created_at_idx" ON "order_messages"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
