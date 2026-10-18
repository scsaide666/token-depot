-- Cross-user recovery sweeps begin with status/expiry rather than userId.
CREATE INDEX "ApiRequest_status_reservationExpiresAt_userId_idx"
  ON "ApiRequest" ("status", "reservationExpiresAt", "userId");
