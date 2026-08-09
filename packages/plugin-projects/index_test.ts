import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import { type IAgent, type IHarness, tameMsgMeta } from "@tame/sdk";
import type { HistoryHook } from "@tame/plugin-history/index";
import { getWorkdir, setEnv } from "@tame/plugin-ops/index";
import { getProject, type ProjectAgentData, ProjectsPlugin } from "./index.ts";

const workdir = resolve("packages/plugin-projects/testdata");

const makeAgent =
	(): IAgent => ({ context: [], pluginData: new Map() } as unknown as IAgent);

Deno.test("project agents inject files, set ops cwd, and persist identity", async () => {
	const plugin = new ProjectsPlugin({
		projects: [{ name: "demo", workdir, files: ["AGENTS.md", "missing.md"] }],
	});
	const agents: IAgent[] = [];
	let historyHook: HistoryHook<ProjectAgentData | null> | undefined;
	type ProjectRoute = {
		call(args: { project: string }): Promise<{ id: string }>;
	};
	let projectRoute: ProjectRoute | undefined;
	const env = {
		defaultWorkdir: "/ops/default",
		resolvePath: (path: string) => path,
	} as never;
	const history = {
		addHook: (_key: string, hook: HistoryHook<ProjectAgentData | null>) =>
			historyHook = hook,
		onSessionsChanged: () => () => {},
	};
	const rpc = {
		register: (_plugin: string, routes: { newAgent: ProjectRoute }) =>
			projectRoute = routes.newAgent,
		emit: () => {},
	};
	const harness = {
		getPlugin: <T>(id: string) => {
			if (id === "history") return history as T;
			if (id === "rpc") return rpc as T;
			if (id === "ops") return {} as T;
			return undefined;
		},
		newAgent: () => {
			const agent = makeAgent();
			agents.push(agent);
			plugin.newAgent(agent);
			setEnv(agent, env);
			return agent;
		},
	} as unknown as IHarness;

	await plugin.init(harness);
	const agent = await plugin.createAgent("demo");
	assertEquals(getProject(agent), "demo");
	assertEquals(getWorkdir(agent), workdir);
	assertEquals(agent.context.length, 1);
	assertEquals(agent.context[0].content[0].type, "text");
	assertEquals(
		(agent.context[0].content[0] as { text: string }).text.includes(
			"AGENTS.md",
		),
		true,
	);
	assertEquals(
		(agent.context[0].content[0] as { text: string }).text.includes(
			"project instructions go here",
		),
		true,
	);
	assertEquals(agent.context[0][tameMsgMeta], {
		automated: true,
		noCompact: true,
	});
	assertEquals(projectRoute !== undefined, true);
	assertEquals(await projectRoute!.call({ project: "demo" }), {
		id: agents.at(-1)!.id,
	});
	assertEquals(agents.length, 2);

	const saved = historyHook!.save(agent);
	assertEquals(saved, { project: "demo" });
	const restored = makeAgent();
	setEnv(restored, env);
	historyHook!.load(restored, saved);
	assertEquals(getProject(restored), "demo");
	assertEquals(getWorkdir(restored), workdir);

	const count = agents.length;
	await assertRejects(
		() => plugin.createAgent("unknown"),
		Error,
		"unknown project",
	);
	assertEquals(agents.length, count);
});

Deno.test("project config rejects duplicate names and escaping injection paths", () => {
	assertThrows(
		() =>
			new ProjectsPlugin({
				projects: [
					{ name: "demo", workdir },
					{ name: "demo", workdir },
				],
			}),
		Error,
		"duplicate project name",
	);
	assertThrows(
		() =>
			new ProjectsPlugin({
				projects: [{ name: "demo", workdir, files: ["../AGENTS.md"] }],
			}),
		Error,
		"must be relative",
	);
});
