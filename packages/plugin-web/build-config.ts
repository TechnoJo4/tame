// Shared rollup/swc configuration values.
// build.js and index.ts wire these into their respective plugin loaders.

export const swcOptions = {
	jsc: {
		parser: { syntax: "typescript" as const, decorators: true },
		transform: { decoratorVersion: "2021-12" as const },
		target: "es2022" as const,
		loose: false,
	},
};

export const tameAliasPattern = /^@tame\/(.*)/;

export const resolveExtensions = [".ts", ".mjs", ".js"];
