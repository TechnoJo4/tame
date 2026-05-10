import { Type, type Static } from "typebox";
import { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import type { Harness } from "../../agent/harness.ts";
import { readTameConfig } from "../../config/index.ts";
import type { OpsPlugin } from "../ops/index.ts";
import { spawn } from "node:child_process";

export const configSchema = Type.Object({
	agentName: Type.String({ default: "tame" }),
	extraTools: Type.Array(Type.String(), { default: [] }),
});

export type AssistedByConfig = Static<typeof configSchema>;

const setupGitConfig = async () => {
	try {
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("git", [
				"config",
				"--global",
				"trailer.assisted-by.key",
				"Assisted-by",
			], { stdio: "ignore" });
			proc.once("close", (code) => code === 0 ? resolve() : reject(new Error(`git config exited ${code}`)));
			proc.once("error", reject);
		});
	} catch {
		console.warn("assisted-by: failed to set git trailer.assisted-by.key (git may not be installed)");
		return;
	}

	try {
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("git", [
				"config",
				"--global",
				"trailer.assisted-by.command",
				`echo $ASSISTED_BY`,
			], { stdio: "ignore" });
			proc.once("close", (code) => code === 0 ? resolve() : reject(new Error(`git config exited ${code}`)));
			proc.once("error", reject);
		});
	} catch {
		console.warn("assisted-by: failed to set git trailer.assisted-by.command");
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

export default new AssistedByPlugin(readTameConfig("assisted-by.json", configSchema));
