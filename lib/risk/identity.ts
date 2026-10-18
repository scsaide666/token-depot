import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export function requestIpHash(request: Request) {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("IP hashing is not configured.");
  const header = process.env.TRUSTED_IP_HEADER;
  if (header && !/^[a-z][a-z0-9-]{0,63}$/.test(header)) throw new Error("Invalid risk configuration.");
  // Web Request exposes no trusted socket address. Never implicitly trust X-Forwarded-For.
  // A configured single-value header must be overwritten by the deployment's proxy.
  const candidate = header ? request.headers.get(header)?.trim() : undefined;
  let address = candidate && candidate.length <= 45 && isIP(candidate) ? candidate.toLowerCase() : "unknown";
  if (isIP(address) === 6) {
    address = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(address);
    if (mapped) { const value = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16); address = [24, 16, 8, 0].map((bits) => (value >>> bits) & 255).join("."); }
  }
  return createHmac("sha256", secret).update(`ip:${address}`).digest("hex");
}
