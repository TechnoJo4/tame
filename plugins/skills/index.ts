import { resolve } from "@std/path";
import { promises as fs } from "node:fs";
import { Plugin } from "../../agent/plugin.ts";
import * as harness from "../../agent/harness.ts";
import { tool, Type } from "../../agent/tool.ts";
import { readTameConfig, tameDataFolder } from "../../config/index.ts";
import { Agent } from "../../agent/agent.ts";
import { tameMsgMeta } from "../../util/symbols.ts";
import { CommandsPlugin } from "../commands/index.ts";

const home = Deno.env.get("HOME");

const configSchema = Type.Object({
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
});

const config = readTameConfig("skills.json", configSchema);

interface Skill {
	name: string;
	description: string;
	location: string;
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
			// metadata is a nested block in YAML; it won't parse line-by-line.
			// For now, skip — we don't strictly need it.
			continue;
		}

		(frontmatter as Record<string, string>)[key] = value;
	}

	return { frontmatter, body };
};

const skills = new Map<string, Skill>();

const scanDir = async (
	dir: string,
	depth: number,
	results: Map<string, Skill>,
): Promise<void> => {
	if (depth > config.maxDepth) return;

	let entries = [];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (config.excludeDirs.includes(entry.name)) continue;

		const subdir = resolve(dir, entry.name);
		const skillPath = resolve(subdir, "SKILL.md");

		try {
			await fs.access(skillPath, fs.constants.R_OK);
		} catch {
			await scanDir(subdir, depth + 1, results);
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
};

const discoverSkills = async (): Promise<Map<string, Skill>> => {
	const results = new Map<string, Skill>();

	for (const rawPath of config.paths) {
		await scanDir(resolve(rawPath), 1, results);
	}

	return results;
};

const buildCatalog = (skills: Map<string, Skill>): string => {
	if (skills.size === 0) return "";

	let catalog = "# Available Skills\n";

	for (const [name, skill] of skills) {
		catalog += `\n- **${name}**: ${skill.description}`;
	}

	return catalog + "\n\nWhen a task matches a skill's description, call activate_skill with the skill's name to load its full instructions.";
};

const buildActivationResult = (skill: Skill): string => {
	let result = `<skill name="${skill.name}">\n\n`;
	result += skill.body;
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

const injectSkillContent = (agent: Agent, skill: Skill, automated: boolean = true): void => {
	const content = buildActivationResult(skill);

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
};

const removeSkillContent = (agent: Agent, skillName: string): void => {
	for (const msg of agent.context) {
		if (msg[tameMsgMeta]?.skill === skillName) {
			msg[tameMsgMeta] = { ...msg[tameMsgMeta], noCompact: undefined };
		}
	}

	const data = agent.pluginData.get(dataKey) as AgentSkillsData;
	data.activated.delete(skillName);
};

export default {
	async init() {
		const discovered = await discoverSkills();
		for (const [name, skill] of discovered) {
			skills.set(name, skill);
		}

		if (skills.size === 0) return;

		harness.tools.push(
			tool({
				name: "activate_skill",
				desc: "Load full instructions for a skill. Call this when a task matches a skill's description from the catalog.",
				args: Type.Object({
					name: Type.String({ description: "Name of the skill to activate" }),
				}),
				exec: async ({ name }, agent) => {
					const skill = skills.get(name);
					if (!skill) {
						const available = [...skills.keys()].join(", ");
						throw new Error(`Unknown skill "${name}". Available: ${available}`);
					}

					const data = agent.pluginData.get(dataKey) as AgentSkillsData;
					if (data.activated.has(name)) {
						return `Skill "${name}" is already activated.`;
					}

					injectSkillContent(agent, skill);
					return `Activated skill "${name}". Instructions are now in context.`;
				},
				view: {
					compact: ({ name }) => `Activate skill ${name}`,
				},
			}),
		);

		harness.tools.push(
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

					removeSkillContent(agent, name);
					return `Deactivated skill "${name}". Its instructions may be compacted when needed.`;
				},
				view: {
					compact: ({ name }) => `Deactivate skill ${name}`,
				},
			}),
		);

		harness.getPlugin(CommandsPlugin)?.add({
			name: "skill",
			description: "Activate a skill by name: /skill <name>",
			run: async (agent, param) => {
				if (!param) throw new Error("Usage: /skill <name>");

				const name = param.trim();
				const skill = skills.get(name);
				if (!skill) {
					const available = [...skills.keys()].join(", ");
					throw new Error(`Unknown skill "${name}". Available: ${available}`);
				}

				const data = agent.pluginData.get(dataKey) as AgentSkillsData;
				if (data.activated.has(name)) {
					removeSkillContent(agent, name);
				}

				injectSkillContent(agent, skill, false); // user-driven, so not automated
			},
		});
	},

	newAgent(agent: Agent) {
		agent.pluginData.set(dataKey, {
			activated: new Set<string>(),
		});

		if (skills.size === 0) return;

		const catalog = buildCatalog(skills);
		agent.context.push({
			role: "user",
			content: [{ type: "text", text: catalog }],
			[tameMsgMeta]: {
				automated: true,
				noCompact: true,
			},
		});
	},
} as Plugin;
