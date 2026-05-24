// Single source of truth for rollup/swc configuration.
// Used by build.js (shell bundling) and index.ts (plugin transpilation).
// Rollup plugins' types claim they're non-callable (namespace exports);
// at runtime they're callable default exports. We use .default and cast.

import swc from "@rollup/plugin-swc";
import resolve from "@rollup/plugin-node-resolve";
import alias from "@rollup/plugin-alias";
import terser from "@rollup/plugin-terser";

// ---- raw config values ----

export const swcOptions = {
	jsc: {
		parser: { syntax: "typescript" as const, decorators: true },
		transform: { decoratorVersion: "2021-12" as const },
		target: "es2022" as const,
		// loose: class field assignment uses = instead of [[Define]].
		// [[Define]] semantics create own data properties that shadow
		// @property accessors on the prototype — Lit reactivity dies.
		loose: true,
	},
};

export const tameAliasPattern = /^@tame\/(.*)/;

export const resolveExtensions = [".ts", ".mjs", ".js"];

// ---- plugin factories ----
// rootDir = repo root (e.g. /home/coder/tame)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RollupPlugin = any;

const _swc = swc as RollupPlugin;
const _alias = alias as RollupPlugin;
const _resolve = resolve as RollupPlugin;
const _terser = terser as RollupPlugin;

export const swcPlugin = _swc({ swc: swcOptions });
export const terserPlugin = _terser();

export function aliasPlugin(rootDir: string) {
	return _alias({
		entries: [
			{ find: tameAliasPattern, replacement: `${rootDir}/packages/$1` },
		],
	});
}

export function resolvePlugin(browser = true) {
	return _resolve({ browser, extensions: resolveExtensions });
}

/** Base plugin chain: alias → resolve → swc. No minification. */
export function basePlugins(rootDir: string, browser = true) {
	return [aliasPlugin(rootDir), resolvePlugin(browser), swcPlugin];
}

/** Full plugin chain with terser minification. */
export function minPlugins(rootDir: string, browser = true) {
	return [...basePlugins(rootDir, browser), terserPlugin];
}
