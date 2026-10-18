import "server-only";
import { lookup } from "node:dns/promises";
import type { LookupOptions, LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, Dispatcher1Wrapper } from "undici";
import type { ModelProvider } from "@/generated/prisma/client";

const prefixes = { OPENAI: "OPENAI", ANTHROPIC: "ANTHROPIC", GOOGLE: "GEMINI", DEEPSEEK: "DEEPSEEK" };
const defaults = { OPENAI: "https://api.openai.com", ANTHROPIC: "https://api.anthropic.com", GOOGLE: "https://generativelanguage.googleapis.com", DEEPSEEK: "https://api.deepseek.com" };
const loopback = (url: URL) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
function localFixtureAllowed(env: NodeJS.ProcessEnv) {
  try {
    const database = new URL(env.DATABASE_URL_TEST ?? "");
    return env.AIHUB_LOCAL_PROVIDER_TESTS === "true" && loopback(database) && database.pathname === "/aihub_auth_test"
      && (env.NODE_ENV !== "production" || env.DATABASE_URL === env.DATABASE_URL_TEST);
  } catch { return false; }
}
function publicHost(url: URL) {
  return url.protocol === "https:" && !isIP(url.hostname.replace(/^\[|\]$/g, "")) && url.hostname.includes(".")
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname);
}
function ipv6Number(address: string) {
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = normalized.split("::");
  const head = left ? left.split(":") : [], tail = right ? right.split(":") : [];
  const words = right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  return words.reduce((value, word) => value << BigInt(16) | BigInt(`0x${word}`), BigInt(0));
}
function inIpv6Range(address: bigint, prefix: string, bits: number) {
  const shift = BigInt(128 - bits);
  return address >> shift === ipv6Number(prefix) >> shift;
}
export function providerBaseUrl(value: string, provider: ModelProvider, env: NodeJS.ProcessEnv = process.env) {
  if (/[\x00-\x20\\]/.test(value)) throw new Error("Invalid upstream configuration.");
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid upstream configuration.");
  if (localFixtureAllowed(env) && loopback(url) && url.protocol === "http:") return url;
  if (!publicHost(url)) throw new Error("Invalid upstream configuration.");
  const configured = env[`${prefixes[provider]}_ALLOWED_ORIGINS`] ?? "";
  if (configured.length > 4096) throw new Error("Invalid upstream configuration.");
  const allowed = configured ? configured.split(",").map(value => {
    const origin = new URL(value.trim());
    if (!publicHost(origin) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid upstream configuration.");
    return origin.origin;
  }) : [];
  if (allowed.length > 20 || ![defaults[provider], ...allowed].includes(url.origin)) throw new Error("Invalid upstream configuration.");
  return url;
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const value = ipv6Number(address);
    // Numeric CIDR comparisons also cover compressed/expanded spellings. Allow
    // global unicast only, conservatively excluding special protocol assignments,
    // both documentation blocks and 6to4; mapped/NAT64/local ranges fall outside.
    return inIpv6Range(value, "2000::", 3) && !inIpv6Range(value, "2001::", 23)
      && !inIpv6Range(value, "2001:db8::", 32) && !inIpv6Range(value, "2002::", 16) && !inIpv6Range(value, "3fff::", 20);
  }
  return false;
}
export function publicAddresses(addresses: LookupAddress[]) {
  if (!addresses.length || addresses.some(value => !isPublicAddress(value.address))) throw new Error("Upstream address is not permitted.");
  return addresses;
}
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export function createPublicLookup(resolve: typeof lookup = lookup): LookupFunction {
  return ((hostname: string, options: LookupOptions, callback: LookupCallback) => {
    const failure = () => callback(Object.assign(new Error("Upstream address is not permitted."), { code: "ENOTFOUND" }), "", 0);
    void resolve(hostname, { all: true, family: options.family ?? 0 }).then(addresses => {
      try { publicAddresses(addresses); } catch { failure(); return; }
      if (options.all) callback(null, addresses); else callback(null, addresses[0].address, addresses[0].family);
    }, failure);
  }) as LookupFunction;
}
// Resolve and validate inside TCP connection setup, not in a separate preflight.
// The socket uses these exact IPs, avoiding a second DNS lookup/rebinding window.
// Node's built-in fetch can still use the v7 handler contract. The official
// wrapper adapts it to v8 without replacing Next's instrumented fetch globally.
export const publicDispatcher = new Dispatcher1Wrapper(new Agent({ connect: { lookup: createPublicLookup(), timeout: 10000 } }));
export function upstreamFetch(url: URL, init: RequestInit) {
  return fetch(url, loopback(url) ? init : { ...init, dispatcher: publicDispatcher } as RequestInit);
}
