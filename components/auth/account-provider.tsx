"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountUser } from "@/lib/account-types";

const AccountContext = createContext<AccountUser | null>(null);
export function AccountProvider({ user, children }: { user: AccountUser; children: ReactNode }) { return <AccountContext.Provider value={user}>{children}</AccountContext.Provider>; }
export function useAccount() { const user = useContext(AccountContext); if (!user) throw new Error("AccountProvider is required."); return user; }
