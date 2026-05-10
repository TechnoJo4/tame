import { Type, type Static } from "typebox";
import { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import type { Harness } from "../../agent/harness.ts";
import type { OpsPlugin } from "../ops/index.ts";
import { tameDataFolder } from "../../config/index.ts";
import { resolve } from "@std/path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

export const configSchema = Type.Object({
	agentName: Type.String({ default: "tame" }),
	extraTools: Type.Array(Type.String(), { default: [] }),
});

export type AssistedByConfig = Static<typeof configSchema>;

const hooksDir = resolve(tameDataFolder, "hooks");

const commitMsgHook = `#!/bin/sh
# tame assisted-by hook
# Appends an Assisted-by trailer to commits, then chains to repo-local hooks.

if [ -n "$ASSISTED_BY" ]; then
	echo "Assisted-by: $ASSISTED_BY" >> "$1"
fi

# Chain to repo-local commit-msg hook if one exists
REPO_GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
if [ -n "$REPO_GIT_DIR" ] && [ -x "$REPO_GIT_DIR/hooks/commit-msg" ]; then
	exec "$REPO_GIT_DIR/hooks/commit-msg" "$@"
fi
`;

const setupGitConfig = async () => {
	// Create ~/.tame/hooks/commit-msg
	try {
		await fs.mkdir(hooksDir, { recursive: true });
	} catch {
		console.warn("assisted-by: failed to create hooks directory");
		return;
	}

	try {
		await fs.writeFile(resolve(hooksDir, "commit-msg"), commitMsgHook, { mode: 0o755 });
	} catch {
		console.warn("assisted-by: failed to write commit-msg hook");
		return;
	}

	// Point git at our hooks directory
	try {
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("git", [
				"config",
				"--global",
				"core.hooksPath",
				hooksDir,
			], { stdio: "ignore" });
			proc.once("close", (code) => code === 0 ? resolve() : reject(new Error(`git config exited ${code}`)));
			proc.once("error", reject);
		});
	} catch {
		console.warn("assisted-by: failed to set core.hooksPath");
	}
};

export class AssistedByPlugin implements Plugin {
	id = "assisted-by" as const;

	#config: AssistedByConfig;

	constructor(config: AssistedByConfig) {
		this.#config = config;
	}

	buildTrailer(agent: Agent): string {
		const model = agent.llm.defaultModel ?? "unknown";
		let trailer = `${this.#config.agentName}:${model}`;
		if (this.#config.extraTools.length > 0) {
			trailer += " " + this.#config.extraTools.join(" ");
		}
		return trailer;
	}

	async init(harness: Harness) {
		await setupGitConfig();

		harness.getPlugin<OpsPlugin>("ops")?.emitter.before("exec", async (e) => {
			const trailer = this.buildTrailer(e.agent);
			e.env = {
				ASSISTED_BY: trailer,
				...e.env,
			};
			return e;
		});
	}
}
