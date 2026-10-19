const { isAbsolute, parse, resolve } = require("node:path");
const { globSync } = require("tinyglobby");

// This is deliberately scoped to Next 16.3.8's getRootDirs call, not a general
// replacement for fast-glob. Refuse a changed caller contract on future upgrades.
exports.globSync = (pattern, options) => {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true ||
    Object.keys(options).some((key) => key !== "onlyDirectories")) {
    throw new TypeError("Unsupported Next.js ESLint glob contract; review the scoped adapter.");
  }
  const absolute = isAbsolute(pattern);
  // A volume-root cwd avoids tinyglobby rebasing absolute patterns against an
  // escaped current directory (for example a Windows sandbox path with braces).
  const root = absolute ? parse(pattern).root : undefined;
  const input = absolute && resolve(pattern) === resolve(root) ? "." : pattern;
  return globSync(input, {
    onlyDirectories: true,
    expandDirectories: false,
    absolute,
    ...(absolute ? { cwd: root } : {}),
  });
};
