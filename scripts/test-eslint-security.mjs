import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This suite uses only generated lint fixtures. It does not load application
// modules, environment files, database clients, payment providers, or API clients.
const projectRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
const { ESLint } = require("eslint");
const pluginEntry = require.resolve("@next/eslint-plugin-next");
const pluginRequire = createRequire(pluginEntry);
const nextPlugin = pluginRequire("@next/eslint-plugin-next");
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js");
const tempParent = realpathSync(tmpdir());
const fixtureRoot = mkdtempSync(path.join(tempParent, "token-depot-eslint-"));
const previousCwd = process.cwd();
let passed = 0;
let failed = 0;

async function check(name, action) {
  try {
    await action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function writeFixture(relativePath, source = "") {
  const target = path.join(fixtureRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
  return target;
}

function canonicalDirectories(directories) {
  return directories.map((directory) => realpathSync(path.resolve(directory))).sort();
}

function assertRootDirs(rootDir, expected) {
  const directories = getRootDirs({
    cwd: fixtureRoot,
    settings: { next: { rootDir } },
  });
  assert.equal(directories.length, expected.length, "root discovery must not recurse into child directories");
  assert.deepEqual(canonicalDirectories(directories), canonicalDirectories(expected));
}

function assertModuleAbsent(resolver, name) {
  assert.throws(
    () => resolver.resolve(name),
    (error) => error.code === "MODULE_NOT_FOUND",
    `${name} must be absent from the installed dependency tree`,
  );
}

try {
  const siteA = path.dirname(path.dirname(writeFixture("apps/site-a/pages/about.tsx", "export default function About() { return null; }\n")));
  writeFixture("apps/site-a/pages/index.tsx", "export default function Home() { return null; }\n");
  writeFixture("apps/site-a/nested/subdir/placeholder.txt");
  const siteB = path.dirname(path.dirname(writeFixture("apps/site-b/app/page.tsx", "export default function Home() { return null; }\n")));
  writeFixture("apps/not-a-directory.txt");
  process.chdir(fixtureRoot);

  await check("lockfile and installed Next plugin resolve the local adapter without the vulnerable chain", () => {
    const lock = JSON.parse(readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
    const adapterPath = realpathSync(path.join(projectRoot, "tooling/eslint-glob"));
    const globEntry = realpathSync(pluginRequire.resolve("fast-glob"));
    assert.equal(globEntry, realpathSync(path.join(adapterPath, "index.cjs")));
    const adapter = JSON.parse(readFileSync(path.join(adapterPath, "package.json"), "utf8"));
    assert.equal(adapter.name, "@token-depot/eslint-glob");
    assert.equal(adapter.version, "1.0.0");
    assert.equal(adapter.dependencies.tinyglobby, "0.2.17");
    assert.equal(lock.packages["tooling/eslint-glob"]?.name, adapter.name);
    const vulnerableEntries = Object.entries(lock.packages).filter(([location, metadata]) =>
      /(?:^|\/)node_modules\/(?:braces|micromatch)$/.test(location)
      || metadata.name === "braces"
      || metadata.name === "micromatch"
      || (/(?:^|\/)node_modules\/fast-glob$/.test(location) && metadata.link !== true),
    );
    assert.deepEqual(vulnerableEntries.map(([location]) => location), [], "lockfile must remove the original fast-glob / micromatch / braces chain");
    const globLinks = Object.entries(lock.packages).filter(([location]) =>
      /(?:^|\/)node_modules\/fast-glob$/.test(location),
    );
    assert(globLinks.length > 0, "lockfile must record the replacement dependency");
    for (const [location, metadata] of globLinks) {
      assert.equal(metadata.link, true, `${location} must link to the local adapter`);
      const target = path.resolve(projectRoot, metadata.resolved);
      assert(existsSync(target), `${location} must not retain a broken local dependency link`);
      assert.equal(realpathSync(target), adapterPath);
    }
    const adapterRequire = createRequire(globEntry);
    for (const resolver of [require, pluginRequire, adapterRequire]) {
      assertModuleAbsent(resolver, "braces");
      assertModuleAbsent(resolver, "micromatch");
    }
    const glob = pluginRequire("fast-glob").globSync;
    assert.equal(typeof glob, "function");
    for (const [pattern, options] of [
      ["apps/*", undefined],
      ["apps/*", {}],
      ["apps/*", { onlyDirectories: false }],
      ["apps/*", { onlyDirectories: true, onlyFiles: false }],
      [["apps/*"], { onlyDirectories: true }],
      [null, { onlyDirectories: true }],
    ]) {
      assert.throws(() => glob(pattern, options), TypeError, "changed Next caller contracts must fail closed");
    }
    const tinyPackage = adapterRequire("tinyglobby/package.json");
    assert.equal(tinyPackage.version, "0.2.17");
    assert.deepEqual(Object.keys(tinyPackage.dependencies).sort(), ["fdir", "picomatch"]);
  });

  await check("default Next root uses context.cwd", () => {
    assert.deepEqual(getRootDirs({ cwd: fixtureRoot, settings: {} }), [fixtureRoot]);
  });

  await check("static relative root does not expand nested directories", () => {
    assertRootDirs("apps/site-a", [siteA]);
    assertRootDirs("./apps/site-a/", [siteA]);
  });

  await check("absolute root remains absolute and denotes the same directory", () => {
    const directories = getRootDirs({ cwd: fixtureRoot, settings: { next: { rootDir: siteA } } });
    assert.equal(directories.length, 1);
    assert(directories.every((directory) => path.isAbsolute(directory)), "absolute root settings must produce absolute paths");
    assert.deepEqual(canonicalDirectories(directories), canonicalDirectories([siteA]));
  });

  await check("absolute root equal to process.cwd() matches that directory", () => {
    const checkCwd = process.cwd();
    try {
      process.chdir(siteA);
      const absoluteRoot = process.cwd();
      const directories = getRootDirs({ cwd: absoluteRoot, settings: { next: { rootDir: absoluteRoot } } });
      assert.equal(directories.length, 1);
      assert(directories.every((directory) => path.isAbsolute(directory)));
      assert.deepEqual(canonicalDirectories(directories), canonicalDirectories([siteA]));
    } finally {
      process.chdir(checkCwd);
    }
  });

  await check("absolute root works when process.cwd() contains literal braces", () => {
    const braceSite = path.dirname(path.dirname(writeFixture("cwd.{fixture}/apps/site-a/pages/index.tsx")));
    const braceCwd = path.join(fixtureRoot, "cwd.{fixture}");
    const checkCwd = process.cwd();
    try {
      process.chdir(braceCwd);
      const directories = getRootDirs({ cwd: braceCwd, settings: { next: { rootDir: braceSite } } });
      assert.equal(directories.length, 1);
      assert(directories.every((directory) => path.isAbsolute(directory)));
      assert.deepEqual(canonicalDirectories(directories), canonicalDirectories([braceSite]));
    } finally {
      process.chdir(checkCwd);
    }
  });

  await check("absolute filesystem root matches only the root directory", () => {
    const filesystemRoot = path.parse(fixtureRoot).root;
    const directories = getRootDirs({ cwd: fixtureRoot, settings: { next: { rootDir: filesystemRoot } } });
    assert.equal(directories.length, 1, "filesystem root discovery must not expand child directories");
    assert(directories.every((directory) => path.isAbsolute(directory)));
    assert.deepEqual(canonicalDirectories(directories), canonicalDirectories([filesystemRoot]));
  });

  await check("Windows separators in relative and absolute roots remain supported", () => {
    assertRootDirs("apps\\site-a", [siteA]);
    assertRootDirs(siteA.replaceAll("/", "\\"), [siteA]);
  });

  await check("glob and brace roots match only the intended directories", () => {
    assertRootDirs("apps/*", [siteA, siteB]);
    assertRootDirs("apps/site-*", [siteA, siteB]);
    assertRootDirs("apps/{site-a,site-b}", [siteA, siteB]);
  });

  await check("array roots and missing roots preserve Next discovery behavior", () => {
    assertRootDirs(["apps/site-a", "apps/site-b", "apps/missing-*", 42], [siteA, siteB]);
    assertRootDirs("apps/missing-*", []);
    assertRootDirs("apps/not-a-directory.txt", []);
  });

  await check("project effective config keeps no-html-link-for-pages enabled as an error", async () => {
    const eslint = new ESLint({ cwd: projectRoot });
    const config = await eslint.calculateConfigForFile(path.join(projectRoot, "app/page.tsx"));
    assert.equal(config.rules["@next/next/no-html-link-for-pages"][0], 2);
  });

  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.jsx"],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { "@next/next": nextPlugin },
      settings: { next: { rootDir: siteA } },
      rules: { "@next/next/no-html-link-for-pages": "error" },
    }],
  });

  await check("real Next ESLint rule still rejects an anchor to an internal fixture page", async () => {
    const [result] = await eslint.lintText('export default function Page() { return <a href="/about">About</a>; }', {
      filePath: path.join(fixtureRoot, "internal-anchor.jsx"),
    });
    assert.equal(result.fatalErrorCount, 0);
    assert(result.messages.some((message) => message.ruleId === "@next/next/no-html-link-for-pages" && message.severity === 2));
  });

  await check("real Next ESLint rule accepts Link and external anchors", async () => {
    for (const [name, source] of [
      ["next-link", 'import Link from "next/link"; export default function Page() { return <Link href="/about">About</Link>; }'],
      ["external-anchor", 'export default function Page() { return <a href="https://example.com/about">About</a>; }'],
    ]) {
      const [result] = await eslint.lintText(source, { filePath: path.join(fixtureRoot, `${name}.jsx`) });
      assert.equal(result.fatalErrorCount, 0);
      assert.deepEqual(result.messages, []);
    }
  });
} finally {
  process.chdir(previousCwd);
  // Verify the absolute resolved directory stays under the verified temp parent
  // before recursive deletion. Only this invocation's mkdtemp directory is removed.
  if (existsSync(fixtureRoot)) {
    const resolvedFixture = realpathSync(fixtureRoot);
    const relativeFixture = path.relative(tempParent, resolvedFixture);
    assert(relativeFixture && !relativeFixture.startsWith("..") && !path.isAbsolute(relativeFixture));
    assert(path.basename(resolvedFixture).startsWith("token-depot-eslint-"));
    rmSync(resolvedFixture, { recursive: true, force: true });
  }
}

console.log(`ESLint security regression: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
