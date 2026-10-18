// The only account shape allowed across the server/client boundary.
export type AccountUser = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
  wallet: { balance: string; reservedBalance: string; balanceDisplay: string };
};

export type AccountSession = { id: string; createdAt: string; expiresAt: string; device: string; current: boolean };
export type FormResponse = { error?: string; fieldErrors?: Partial<Record<"name" | "email" | "password" | "confirmPassword", string>>; user?: AccountUser };
