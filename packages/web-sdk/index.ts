// Compatibility shim for node-style directory resolution (used by rollup).
// Deno uses deno.json "exports" field and ignores this file.
export * from "./mod.ts";
