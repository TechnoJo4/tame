import { Type } from "typebox";
import { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import { readTameConfig } from "../../config/index.ts";
import { ops } from "../ops/index.ts";
import { spawn } from "node:child_process";

const configSchema = Type.Object({
	agentName: Type.String({ default: "tame" }),
	extraTools: Type.Array(Type.String(), { default: [] }),
});

const config = readTameConfig("assisted-by.json", configSchema);

const buildTrailer = (agent: Agent): string => {
	const model = agent.llm.defaultModel ?? "unknown";
	let trailer = `${config.agentName}:${model}`;
	if (config.extraTools.length > 0) {
		trailer += " " + config.extraTools.join(" ");
	}
	return trailer;
};

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

export default {
	async init() {
		await setupGitConfig();

		ops.before("exec", async (e) => {
			const trailer = buildTrailer(e.agent);
			e.env = {
				ASSISTED_BY: trailer,
				...e.env,
			};
			return e;
		});
	}
} as Plugin;
