import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 65536;
const r = 8;
const p = 2;
const keyLength = 64;
const maxmem = 128 * 1024 * 1024;
// Unknown emails still perform the same expensive password verification.
export const DUMMY_PASSWORD_HASH = `scrypt$${N}$${r}$${p}$${"0".repeat(32)}$${"0".repeat(128)}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, keyLength, { N, r, p, maxmem }, (error, key) => error ? reject(error) : resolve(key)));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(N) || parts[2] !== String(r) || parts[3] !== String(p) || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const key = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(key, Buffer.from(parts[5], "hex"));
}
