import assert from "node:assert/strict";
import { recoverUserBatches } from "./recovery-batch";

async function main() {
  const attempted: string[] = [];
  const result = await recoverUserBatches(["stuck", "next", "last"], async userId => {
    attempted.push(userId);
    if (userId === "stuck") throw new Error("Simulated wallet lock failure");
  });
  assert.deepEqual(attempted, ["stuck", "next", "last"]);
  assert.deepEqual(result, { recoveredUserBatches: 2, failedUserBatches: 1 });
  console.log("PASS a failed user does not prevent subsequent reservation recovery batches");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
