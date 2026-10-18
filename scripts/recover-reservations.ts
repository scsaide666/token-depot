import { config } from "dotenv";
import { getDb } from "../lib/server/db";
import { recoverExpiredReservations } from "../lib/billing/wallet";
import { recoverUserBatches } from "./recovery-batch";

// Trusted operator job only; no HTTP endpoint. Reuses the same Wallet row lock and
// idempotent recovery used on admission. Repeat until the bounded batch is empty.
config({ quiet: true });
const db = getDb();
async function main() {
  const users = await db.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "ApiRequest" WHERE status = 'PENDING'
      AND "reservationExpiresAt" <= NOW() GROUP BY "userId"
      ORDER BY MIN("reservationExpiresAt"), "userId" LIMIT 100`;
  const result = await recoverUserBatches(users.map(({ userId }) => userId), recoverExpiredReservations);
  const pendingExpiredRequests = await db.apiRequest.count({ where: { status: "PENDING", reservationExpiresAt: { lte: new Date() } } });
  console.log(JSON.stringify({ ...result, pendingExpiredRequests, batchLimit: 100 }));
  if (result.failedUserBatches) { console.error("Reservation recovery failed for one or more user batches; details suppressed."); process.exitCode = 1; }
}
main().catch(() => { console.error("Reservation recovery failed; details suppressed."); process.exitCode = 1; })
  .finally(() => db.$disconnect());
