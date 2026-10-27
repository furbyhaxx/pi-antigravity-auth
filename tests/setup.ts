import { afterAll, afterEach, jest, type Mock, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot } from "./support/test-root.ts";

const root = createTestRoot({
	env: process.env,
	testFile: Bun.main,
	diskTempDir: tmpdir(),
});
const home = join(root, "home");
const config = join(root, "config");
const cache = join(root, "cache");
const data = join(root, "data");
const state = join(root, "state");
const pi = join(root, "pi-agent");

for (const path of [home, config, cache, data, state, pi]) mkdirSync(path, { recursive: true });

process.env["ANTIGRAVITY_TEST_ROOT"] = root;
process.env["HOME"] = home;
process.env["USERPROFILE"] = home;
process.env["XDG_CONFIG_HOME"] = config;
process.env["XDG_CACHE_HOME"] = cache;
process.env["XDG_DATA_HOME"] = data;
process.env["XDG_STATE_HOME"] = state;
process.env["APPDATA"] = config;
process.env["LOCALAPPDATA"] = cache;
process.env["PI_AGENT_DIR"] = pi;
// Pi's native credential reader uses its own directory override.
process.env["PI_CODING_AGENT_DIR"] = pi;
process.env["PI_ANTIGRAVITY_AUTH_FILE"] = join(pi, "antigravity-accounts.json");

const stubbedGlobals = new Map<string, unknown>();
const dateNowSpyState: { active: boolean } = { active: false };

/**
 * Replace a global (e.g. `globalThis.fetch`) for a single test, restoring
 * whatever was there before. Bun has no direct stubGlobal helper, so tests
 * use this — paired with `globalThis.unstubAllGlobals()` in `afterEach`.
 */
(globalThis as Record<string, unknown>)["stubbed"] = (name: string, value: unknown) => {
	if (!stubbedGlobals.has(name)) {
		stubbedGlobals.set(name, (globalThis as Record<string, unknown>)[name]);
	}
	(globalThis as Record<string, unknown>)[name] = value;
};

/**
 * Restore every global replaced via `globalThis.stubbed(...)` since the last
 * reset. Tests call this in `afterEach` to undo stubbedGlobal equivalents.
 */
(globalThis as Record<string, unknown>)["unstubAllGlobals"] = () => {
	for (const [name, original] of stubbedGlobals) {
		(globalThis as Record<string, unknown>)[name] = original;
	}
	stubbedGlobals.clear();
};

/**
 * Cache-busting dynamic import — re-evaluates the module so module-level
 * mutable state (e.g. `versionLocked`) resets between tests. Stands in for
 * the Vitest resetModules-style API which Bun does not provide.
 */
(globalThis as Record<string, unknown>)["freshImport"] = async (specifier: string) => {
	const busted = `${specifier}?bust=${Math.random().toString(36).slice(2)}`;
	return import(busted);
};

/**
 * `jest.setSystemTime(date)` only fakes Bun's timer clock in bun:test, not
 * `Date.now()`. Real code under test reads `Date.now()`, so we wrap the call
 * to also spy on `Date.now()` and restore on `jest.useRealTimers()`.
 */
const originalSetSystemTime = jest.setSystemTime.bind(jest);
const originalUseRealTimers = jest.useRealTimers.bind(jest);

jest.setSystemTime = ((dateOrEpochMs: Date | number) => {
	const epoch = typeof dateOrEpochMs === "number" ? dateOrEpochMs : dateOrEpochMs.getTime();
	originalSetSystemTime(dateOrEpochMs);
	if (!dateNowSpyState.active) {
		spyOn(Date, "now").mockImplementation(() => epoch);
		dateNowSpyState.active = true;
	} else {
		(Date.now as unknown as Mock<() => number>).mockImplementation(() => epoch);
	}
}) as typeof jest.setSystemTime;

jest.useRealTimers = (() => {
	if (dateNowSpyState.active) {
		mock.restore();
		dateNowSpyState.active = false;
	}
	originalUseRealTimers();
}) as typeof jest.useRealTimers;

// Restore real timers after every test so a stray `jest.useFakeTimers()`
// in a test that forgets to clean up after itself does not leak into
// subsequent test files — bun runs all `--isolate` files in one
// process, and leftover fake timers would block the event loop from
// exiting cleanly between test files.
afterEach(() => {
	jest.useRealTimers();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));
