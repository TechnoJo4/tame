import { promises as fs } from "node:fs";
import {
	type IAgent,
	type IHarness,
	type Plugin,
	tameMsgMeta,
} from "@tame/sdk";
import { call } from "@tame/rpc-sdk";
import type { HistoryHook, HistoryPlugin } from "@tame/plugin-history/index";
import type { Env, OpsPlugin } from "@tame/plugin-ops/index";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import type { WebPlugin } from "@tame/plugin-web/index";
import { rpcSchema } from "./rpc-schema.ts";
import type { ProjectConfig, ProjectsConfig } from "./config.ts";

const dataKey = Symbol("tame:projects:agent-data");

export interface ProjectAgentData {
	project?: string;
}

export const getProject = (agent: IAgent): string | undefined =>
	(agent.pluginData.get(dataKey) as ProjectAgentData | undefined)?.project;

const setProject = (agent: IAgent, project?: string) => {
	agent.pluginData.set(dataKey, { project });
};

const projectFiles = (project: ProjectConfig): string[] =>
	project.files ?? ["AGENTS.md"];

const isAbsolutePath = (path: string): boolean =>
	path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);

const escapesWorkdir = (path: string): boolean => {
	let depth = 0;
	for (const part of path.split(/[\\/]+/)) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (depth === 0) return true;
			--depth;
		} else {
			++depth;
		}
	}
	return false;
};

const validateConfig = (config: ProjectsConfig): Map<string, ProjectConfig> => {
	const projects = new Map<string, ProjectConfig>();
	for (const project of config.projects) {
		if (projects.has(project.name)) {
			throw new Error(
				`invalid projects config: duplicate project name "${project.name}"`,
			);
		}

		for (const file of projectFiles(project)) {
			if (isAbsolutePath(file) || escapesWorkdir(file)) {
				throw new Error(
					`invalid project "${project.name}": file "${file}" must be relative to its workdir`,
				);
			}
		}
		projects.set(project.name, project);
	}
	return projects;
};

export class ProjectsPlugin implements Plugin {
	id = "projects" as const;

	readonly #projects: Map<string, ProjectConfig>;
	#harness?: IHarness;
	#ops?: OpsPlugin;
	#history?: HistoryPlugin;
	#rpc?: RPCPlugin;

	constructor(config: ProjectsConfig) {
		this.#projects = validateConfig(config);
	}

	listProjects(): ProjectConfig[] {
		return [...this.#projects.values()];
	}

	getProject(name: string): ProjectConfig | undefined {
		return this.#projects.get(name);
	}

	async init(harness: IHarness) {
		this.#harness = harness;
		this.#ops = harness.getPlugin<OpsPlugin>("ops");

		const rpc = harness.getPlugin<RPCPlugin>("rpc");
		this.#rpc = rpc;
		rpc?.register("projects", {
			newAgent: call({
				...rpcSchema.newAgent,
				call: async ({ project }) => ({
					id: (await this.createAgent(project)).id,
				}),
			}),
			listSessions: call({
				...rpcSchema.listSessions,
				call: async () => ({ sessions: await this.listSessions() }),
			}),
			loadSession: call({
				...rpcSchema.loadSession,
				call: async ({ id }) => {
					if (!this.#history) {
						throw new Error("plugin-history is not installed");
					}
					return { id: (await this.#history.loadAgent(id)).id };
				},
			}),
		});

		const history = harness.getPlugin<HistoryPlugin>("history");
		this.#history = history;
		history?.onSessionsChanged(() =>
			this.#rpc?.emit({
				type: "event",
				plugin: "projects",
				event: "sessionsChanged",
				data: {},
			})
		);
		history?.addHook<ProjectAgentData | null>(
			"projects",
			{
				save: (agent) => {
					const project = getProject(agent);
					return project ? { project } : null;
				},
				load: (agent, data) => {
					if (data?.project) {
						setProject(agent, data.project);
						this.#applyOpsWorkdir(agent, data.project);
					}
				},
			} satisfies HistoryHook<ProjectAgentData | null>,
		);

		const web = harness.getPlugin<WebPlugin>("web");
		if (web) {
			const dir = import.meta.dirname!;
			await web.register("projects", [{
				tag: "tame-project-sessions",
				src: web.resolve(dir, "./web/project-sessions.ts"),
			}], [{
				location: "panel:sidebar",
				tag: "tame-project-sessions",
				props: {
					projects: this.listProjects().map((project) => project.name),
					hasHistory: history !== undefined,
				},
			}], web.resolve(dir, "./web/project-sessions.css"));
		}
	}

	newAgent(agent: IAgent) {
		setProject(agent);
	}

	async createAgent(name: string): Promise<IAgent> {
		const project = this.#projects.get(name);
		if (!project) {
			throw new Error(`unknown project "${name}"`);
		}
		if (!this.#harness) {
			throw new Error("plugin-projects is not initialized");
		}
		if (!this.#ops) {
			throw new Error("plugin-projects requires plugin-ops");
		}

		const agent = this.#harness.newAgent();
		setProject(agent, name);
		const env = this.#ops.getEnv(agent);
		const workdir = env.resolvePath(project.workdir);
		try {
			if (!(await fs.stat(workdir)).isDirectory()) {
				throw new Error(`${workdir}: not a directory`);
			}
		} catch (e) {
			if (e instanceof Error && e.message.endsWith(": not a directory")) {
				throw e;
			}
			throw new Error(`project "${name}" workdir ${workdir}: access failed`);
		}

		this.#ops.setWorkdir(agent, workdir);
		const files = await this.#readFiles(env, project, workdir);

		for (const [path, content] of files) {
			agent.context.push({
				role: "user",
				content: [{
					type: "text",
					text: `Instructions from ${path}:\n\n${content}`,
				}],
				[tameMsgMeta]: { automated: true, noCompact: true },
			});
		}
		return agent;
	}

	#applyOpsWorkdir(agent: IAgent, name: string) {
		const project = this.#projects.get(name);
		if (!project || !this.#ops) return;
		this.#ops.setWorkdir(
			agent,
			this.#ops.getEnv(agent).resolvePath(project.workdir),
		);
	}

	async listSessions() {
		if (!this.#history) return [];
		const sessions = await this.#history.list();
		const results = await Promise.all(sessions.map(async (session) => {
			try {
				const history = await this.#history!.load(session.id);
				const data = history.extra.projects;
				const project = data && typeof data === "object" && "project" in data &&
						typeof data.project === "string"
					? data.project
					: undefined;
				return { ...session, project };
			} catch (e) {
				console.warn(
					`plugin-projects: skipping unreadable session ${session.id}:`,
					e,
				);
				return null;
			}
		}));
		return results.filter((session): session is NonNullable<typeof session> =>
			session !== null
		);
	}

	async #readFiles(
		env: Env,
		project: ProjectConfig,
		workdir: string,
	): Promise<[string, string][]> {
		const files: [string, string][] = [];
		for (const file of projectFiles(project)) {
			const path = env.resolvePath(workdir, file);
			try {
				const content = await env.lock(path, async (fileEnv) => {
					if (!await fileEnv.exists()) return undefined;
					return new TextDecoder().decode(await fileEnv.read());
				});
				if (content !== undefined) {
					files.push([env.contractPath(path), content]);
				}
			} catch (e) {
				throw new Error(
					`project "${project.name}" file ${
						env.contractPath(path)
					}: access failed`,
					{ cause: e },
				);
			}
		}
		return files;
	}
}
