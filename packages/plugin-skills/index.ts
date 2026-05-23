import { resolve } from "@std/path";
import { promises as fs } from "node:fs";
import { Plugin, tool, Type, tameDataFolder, tameMsgMeta, type IAgent, type IHarness } from "@tame/sdk";
import type { CommandsPlugin } from "@tame/plugin-commands/index";
import type { Static } from "typebox";

const home = Deno.env.get("HOME");

export const configSchema = Type.Object({
	paths: Type.Array(Type.String(), {
		default: [
			"./.agents/skills",
			"./.tame/skills",
			resolve(home!, ".agents/skills"),
			resolve(tameDataFolder, "skills"),
		],
	}),
	maxDepth: Type.Number({ default: 4 }),
	excludeDirs: Type.Array(Type.String(), { default: [".git", "node_modules", ".venv", "__pycache__"] }),
	addCatalog: Type.Optional(Type.Boolean({ default: true })),
	addTools: Type.Optional(Type.Boolean({ default: true })),
});

export type SkillsConfig = Static<typeof configSchema>;

export interface Skill {
	name: string;
	description: string;
	location: string;
	whenToUse?: string;
	argNames?: string[];
	compatibility?: string;
	allowedTools?: string;
	license?: string;
	metadata?: Record<string, string>;
	body: string;
}

const dataKey = Symbol("tame:skills:data");

interface AgentSkillsData {
	activated: Set<string>;
}

interface Frontmatter {
	name?: string;
	description?: string;
	"when-to-use"?: string;
	"arg-names"?: string;
	compatibility?: string;
	license?: string;
	metadata?: Record<string, string>;
	"allowed-tools"?: string;
}

const parseFrontmatter = (content: string): { frontmatter: Frontmatter; body: string } | null => {
	if (!content.startsWith("---")) return null;

	const end = content.indexOf("---", 3);
	if (end === -1) return null;

	const yamlBlock = content.slice(3, end);
	const body = content.slice(end + 3).trim();

	const frontmatter: Frontmatter = {};
	for (const line of yamlBlock.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		let value = line.slice(colonIdx + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		if (key === "metadata") {
			continue;
		}

		(frontmatter as Record<string, string>)[key] = value;
	}

	return { frontmatter, body };
};

const buildCatalog = (skills: Map<string, Skill>): string => {
	if (skills.size === 0) return "";

	let catalog = "# Available Skills\n";

	for (const [name, skill] of skills) {
		catalog += `\n- **${name}**: ${skill.description}`;
	}

	return catalog + "\n\nWhen a task matches a skill's description, call activate_skill with the skill's name to load its full instructions.";
};

const buildActivationResult = (skill: Skill, args?: Record<string, string>): string => {
	let body = skill.body;
	if (args) {
		for (const [key, value] of Object.entries(args)) {
			body = body.replaceAll(`$\{${key}}`, value);
			body = body.replaceAll(`${key}`, value);
		}
	}

	let result = `<skill name="${skill.name}">\n\n`;
	result += body;
	result += "\n\n</skill>";

	const meta: string[] = [];
	if (skill.compatibility) meta.push(`Compatibility: ${skill.compatibility}`);
	if (skill.allowedTools) meta.push(`Allowed tools: ${skill.allowedTools}`);
	if (skill.license) meta.push(`License: ${skill.license}`);

	if (meta.length > 0) {
		result += "\n\n" + meta.join("\n");
	}

	result += `\n\nSkill directory: ${skill.location}`;

	return result;
};

export class SkillsPlugin implements Plugin {
	id = "skills" as const;

	#config: SkillsConfig;
	#skills = new Map<string, Skill>();

	constructor(config: SkillsConfig) {
		this.#config = config;
	}

	async scanDir(
		dir: string,
		depth: number,
		results: Map<string, Skill>,
	): Promise<void> {
		if (depth > this.#config.maxDepth) return;

		let entries = [];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (this.#config.excludeDirs.includes(entry.name)) continue;

			const subdir = resolve(dir, entry.name);
			const skillPath = resolve(subdir, "SKILL.md");

			try {
				await fs.access(skillPath, fs.constants.R_OK);
			} catch {
				await this.scanDir(subdir, depth + 1, results);
				continue;
			}

			try {
				const raw = await fs.readFile(skillPath, { encoding: "utf-8" });
				const parsed = parseFrontmatter(raw);

				if (!parsed || !parsed.frontmatter.name) {
					console.warn(`skills: ${skillPath} has no valid frontmatter name, skipping`);
					continue;
				}

				const fm = parsed.frontmatter;
				if (!fm.description) {
					console.warn(`skills: ${skillPath} has no description, skipping`);
					continue;
				}

				const skill: Skill = {
					name: fm.name!,
					description: fm.description,
					location: subdir,
					whenToUse: fm["when-to-use"],
					argNames: fm["arg-names"]?.split(",").map(s => s.trim()).filter(s => s.length > 0),
					compatibility: fm.compatibility,
					allowedTools: fm["allowed-tools"],
					license: fm.license,
					metadata: fm.metadata,
					body: parsed.body,
				};

				if (!results.has(skill.name)) {
					results.set(skill.name, skill);
				} else {
					console.warn(`skills: "${skill.name}" from ${skillPath} shadowed by earlier discovery`);
				}
			} catch (err) {
				console.warn(`skills: error parsing ${skillPath}:`, err);
			}
		}
	}

	async discoverSkills(): Promise<Map<string, Skill>> {
		const results = new Map<string, Skill>();

		for (const rawPath of this.#config.paths) {
			await this.scanDir(resolve(rawPath), 1, results);
		}

		return results;
	}

	getSkill(name: string): Skill | undefined {
		return this.#skills.get(name);
	}

	listSkills(): Skill[] {
		return [...this.#skills.values()];
	}

	isSkillActivated(agent: IAgent, name: string): boolean {
		const data = agent.pluginData.get(dataKey) as AgentSkillsData | undefined;
		return data?.activated.has(name) ?? false;
	}

	injectSkillContent(agent: IAgent, skill: Skill, automated: boolean = true, args?: Record<string, string>): void {
		const content = buildActivationResult(skill, args);

		agent.context.push({
			role: "user",
			content: [{ type: "text", text: content }],
			[tameMsgMeta]: {
				automated: automated as true | undefined,
				noCompact: true,
				skill: skill.name,
			},
		});

		const data = agent.pluginData.get(dataKey) as AgentSkillsData;
		data.activated.add(skill.name);
	}

	removeSkillContent(agent: IAgent, skillName: string): void {
		for (const msg of agent.context) {
			if (msg[tameMsgMeta]?.skill === skillName) {
				msg[tameMsgMeta] = { ...msg[tameMsgMeta], noCompact: undefined };
			}
		}

		const data = agent.pluginData.get(dataKey) as AgentSkillsData;
		data.activated.delete(skillName);
	}

	async init(harness: IHarness) {
		const discovered = await this.discoverSkills();
		for (const [name, skill] of discovered) {
			this.#skills.set(name, skill);
		}

		if (this.#skills.size === 0) return;

		if (this.#config.addTools !== false) {
			harness.addTools(
				tool({
					name: "activate_skill",
					desc: "Load full instructions for a skill. Call this when a task matches a skill's description from the catalog.",
					args: Type.Object({
						name: Type.String({ description: "Name of the skill to activate" }),
					}),
					exec: async ({ name }, agent) => {
						const skill = this.#skills.get(name);
						if (!skill) {
							const available = [...this.#skills.keys()].join(", ");
							throw new Error(`Unknown skill "${name}". Available: ${available}`);
						}

						const data = agent.pluginData.get(dataKey) as AgentSkillsData;
						if (data.activated.has(name)) {
							return `Skill "${name}" is already activated.`;
						}

						this.injectSkillContent(agent, skill);
						return `Activated skill "${name}". Instructions are now in context.`;
					},
					view: {
						compact: ({ name }) => `Activate skill ${name}`,
					},
				}),
			);

			harness.addTools(
				tool({
					name: "deactivate_skill",
					desc: "Deactivate a skill, allowing its instructions to be compacted away. Use when a skill is no longer relevant to the current task.",
					args: Type.Object({
						name: Type.String({ description: "Name of the skill to deactivate" }),
					}),
					exec: async ({ name }, agent) => {
						const data = agent.pluginData.get(dataKey) as AgentSkillsData;
						if (!data.activated.has(name)) {
							throw new Error(`Skill "${name}" is not currently activated.`);
						}

						this.removeSkillContent(agent, name);
						return `Deactivated skill "${name}". Its instructions may be compacted when needed.`;
					},
					view: {
						compact: ({ name }) => `Deactivate skill ${name}`,
					},
				}),
			);
		}

		harness.getPlugin<CommandsPlugin>("commands")?.add({
			name: "skill",
			description: "Activate a skill by name: /skill <name>",
			run: async (agent, param) => {
				if (!param) throw new Error("Usage: /skill <name>");

				const name = param.trim();
				const skill = this.#skills.get(name);
				if (!skill) {
					const available = [...this.#skills.keys()].join(", ");
					throw new Error(`Unknown skill "${name}". Available: ${available}`);
				}

				const data = agent.pluginData.get(dataKey) as AgentSkillsData;
				if (data.activated.has(name)) {
					this.removeSkillContent(agent, name);
				}

				this.injectSkillContent(agent, skill, false);
			},
		});
	}

	newAgent(agent: IAgent) {
		agent.pluginData.set(dataKey, {
			activated: new Set<string>(),
		});

		if (this.#skills.size === 0) return;
		if (this.#config.addCatalog === false) return;

		const catalog = buildCatalog(this.#skills);
		agent.context.push({
			role: "user",
			content: [{ type: "text", text: catalog }],
			[tameMsgMeta]: {
				automated: true,
				noCompact: true,
			},
		});
	}
}
