export type ApiKeyStatus = "active" | "revoked" | "expired";

// Public metadata only. Neither the hash nor the full secret belongs here.
export type ApiKeyRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: ApiKeyStatus;
};

export const maskedApiKey = (record: ApiKeyRecord) => `${record.keyPrefix}••••••••`;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const apiKeyDate = (value: string) => dateFormat.format(new Date(value));
export const apiKeyLastUsed = (value: string | null) => value ? apiKeyDate(value) : "Never";
