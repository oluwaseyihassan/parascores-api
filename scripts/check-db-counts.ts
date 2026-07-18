import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '../prisma/generated/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const counts = await prisma.$transaction([
    prisma.tournament.count(),
    prisma.fixture.count(),
    prisma.participant.count(),
    prisma.user.count(),
    prisma.team.count(),
    prisma.organization.count(),
    prisma.standing.count(),
  ]);

  console.log({
    tournaments: counts[0],
    fixtures: counts[1],
    participants: counts[2],
    users: counts[3],
    teams: counts[4],
    organizations: counts[5],
    standings: counts[6],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
