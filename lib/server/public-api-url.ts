import "server-only";

export function publicApiBaseUrl() {
  const origin = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("Invalid application origin.");
  }
  return `${origin.origin}/v1`;
}
