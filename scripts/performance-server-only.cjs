// Next normally aliases this compile-time marker in its server bundle. The direct
// Node harness has no Next renderer; alias ONLY the marker, not auth or DB code.
// Node --require preloads run synchronously as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { config } = require("dotenv");
config({ quiet: true });
const url = process.env.DATABASE_URL_TEST;
if (!url || url === process.env.DATABASE_URL || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/aihub_auth_test") {
  throw new Error("Direct harness requires the isolated local test database.");
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  return original.call(this, name, ...args);
};
