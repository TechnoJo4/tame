import { Type, type Static } from "typebox";
import type { Plugin, IHarness } from "@tame/sdk";
import type { OpsPlugin } from "@tame/plugin-ops/index";

// ---- schema ----

export const guardRule = Type.Object({
	/** Regex pattern to match against the full command string. */
	pattern: Type.String({ description: "Regex pattern to match against the full command string" }),
	/** Message to show when this rule triggers. */
	message: Type.String({ description: "Error message to show when the pattern matches" }),
	/** If true, the regex is treated as case-insensitive. */
	caseInsensitive: Type.Optional(Type.Boolean({ default: false, description: "Case-insensitive matching" })),
});

export type GuardRule = Static<typeof guardRule>;

export const configSchema = Type.Object({
	rules: Type.Array(guardRule, {
		default: [],
		description: "List of guard rules. Each rule has a regex pattern and a message.",
	}),
});

export type GuardConfig = Static<typeof configSchema>;

// ---- plugin ----

const commandToString = (command: string[]): string => command.join(" ");

export class GuardPlugin implements Plugin {
	id = "guard" as const;

	#rules: GuardRule[];
	#compiled: { regex: RegExp; message: string }[] = [];

	constructor(config: GuardConfig) {
		this.#rules = config.rules;
		this.#compileRules();
	}

	#compileRules() {
		this.#compiled = [];
		for (const rule of this.#rules) {
			try {
				const flags = rule.caseInsensitive ? "i" : "";
				this.#compiled.push({
					regex: new RegExp(rule.pattern, flags),
					message: rule.message,
				});
			} catch (e) {
				console.warn(`guard: invalid regex pattern "${rule.pattern}": ${e}. Skipping.`);
			}
		}
	}

	addRule(rule: GuardRule) {
		this.#rules.push(rule);
		try {
			const flags = rule.caseInsensitive ? "i" : "";
			this.#compiled.push({
				regex: new RegExp(rule.pattern, flags),
				message: rule.message,
			});
		} catch (e) {
			console.warn(`guard: invalid regex pattern "${rule.pattern}": ${e}. Skipping.`);
		}
	}

	async init(harness: IHarness) {
		if (this.#compiled.length === 0) return;

		const ops = harness.getPlugin<OpsPlugin>("ops");
		if (!ops) {
			console.warn("guard: ops plugin not found, guard rules will not be applied.");
			return;
		}

		ops.emitter.before("exec", async (e) => {
			const cmdStr = commandToString(e.command);
			for (const { regex, message } of this.#compiled) {
				if (regex.test(cmdStr)) {
					throw new Error(`command blocked by guard rule: ${message}`);
				}
			}
			return e;
		});
	}
}
