export async function recoverUserBatches(userIds: string[], recover: (userId: string) => Promise<unknown>) {
  let failed = 0;
  for (const userId of userIds) {
    try { await recover(userId); }
    catch { failed++; }
  }
  return { recoveredUserBatches: userIds.length - failed, failedUserBatches: failed };
}
