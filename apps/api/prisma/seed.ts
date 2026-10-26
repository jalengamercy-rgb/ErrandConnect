// Fills a fresh database with the data the platform needs to run.
// Safe to run more than once: it updates rows instead of duplicating them.
// Run with: npm run db:seed
import 'dotenv/config';
import { DEFAULT_PRICING_CONFIG } from '@errandconnect/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, WalletType } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

// The errand types from the runner "Services Offered" list.
const CATEGORIES: [slug: string, name: string][] = [
  ['grocery-shopping', 'Grocery Shopping'],
  ['food-delivery', 'Food Delivery'],
  ['parcel-delivery', 'Parcel Delivery'],
  ['medicine-pickup', 'Medicine Pickup'],
  ['document-delivery', 'Document Delivery'],
  ['queueing', 'Queueing'],
  ['banking-errands', 'Banking Errands'],
  ['laundry-pickup', 'Laundry Pickup'],
  ['gift-delivery', 'Gift Delivery'],
  ['furniture-delivery', 'Furniture Delivery'],
  ['business-deliveries', 'Business Deliveries'],
  ['personal-assistant', 'Personal Assistant'],
  ['house-shopping', 'House Shopping'],
  ['airport-pickup', 'Airport Pickup'],
  ['custom-errands', 'Custom Errands'],
];

// Wallets owned by the platform itself (not by any user).
const PLATFORM_WALLETS = [WalletType.PLATFORM_REVENUE, WalletType.ESCROW, WalletType.EXTERNAL_CLEARING];

async function main() {
  for (const [index, [slug, name]] of CATEGORIES.entries()) {
    await prisma.serviceCategory.upsert({
      where: { slug },
      update: { name, sortOrder: index },
      create: { slug, name, sortOrder: index },
    });
  }

  for (const type of PLATFORM_WALLETS) {
    // Postgres treats NULL owner ids as distinct, so a unique index can't stop
    // duplicates here; check first instead.
    const existing = await prisma.wallet.findFirst({ where: { type, userId: null, businessId: null, merchantId: null } });
    if (!existing) await prisma.wallet.create({ data: { type } });
  }

  // Only set default pricing if admins haven't configured their own.
  await prisma.platformSetting.upsert({
    where: { key: 'pricing' },
    update: {},
    create: { key: 'pricing', value: DEFAULT_PRICING_CONFIG as object },
  });

  console.log(`Seeded ${CATEGORIES.length} categories, ${PLATFORM_WALLETS.length} platform wallets, pricing settings.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
