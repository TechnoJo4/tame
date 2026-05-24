/// <reference path="./rpc.d.ts" />
import { type Plugin, tameDataFolder, tameMsgMeta, type IAgent, type IHarness, type InputMessage, type TameMessageMeta } from "@tame/sdk";
import { call } from "@tame/rpc-sdk";
import { rpcSchema } from "./rpc-schema.ts";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import type { WebPlugin } from "@tame/plugin-web/index";
import { promises as fs } from "node:fs";
import { resolve } from "@std/path";

const historyFolder = resolve(tameDataFolder, "history");
const indexFile = resolve(historyFolder, "index.json");

const dataKey = Symbol("tame:history:plugin-data-key");

export interface History {
	id: string;
	title?: string;
	system: string;
	context: InputMessage[];
	history: InputMessage[];
	extra: Record<string, unknown>;
	lastMessageAt?: number;
}

export interface SessionInfo {
	id: string;
	title?: string;
	lastMessageAt?: number;
}

export type PersistedMessage = InputMessage & {
	[tameMsgMeta]: undefined;
	_tame?: TameMessageMeta;
};

export type PersistedHistory = History & {
	context: PersistedMessage[];
	history: PersistedMessage[];
}

export interface HistoryAgentData {
	title?: string;
	history: InputMessage[];
	lastMessageAt?: number;
}

export const messageToPersisted = (msg: InputMessage): PersistedMessage => ({
	...msg,
	[tameMsgMeta]: undefined,
	_tame: msg?.[tameMsgMeta]
});

export const messageFromPersisted = (msg: PersistedMessage): InputMessage => ({
	...msg,
	[tameMsgMeta]: msg?._tame
});

export const getAgentHistory = (agent: IAgent): HistoryAgentData => {
	if (!agent.pluginData.has(dataKey))
		agent.pluginData.set(dataKey, {
			history: []
		});
	return agent.pluginData.get(dataKey) as HistoryAgentData;
}

export interface HistoryHook<T> {
	save(agent: IAgent): T;
	load(agent: IAgent, t: T): void;
}

export class HistoryPlugin implements Plugin {
	id = "history" as const;

	#harness: IHarness | undefined;
	#hooks = new Map<string, HistoryHook<unknown>>();
	#rpc: RPCPlugin | undefined;

	enabled?: true;

	async init(harness: IHarness) {
		this.#harness = harness;
		try {
			await fs.access(historyFolder);
		} catch {
			await fs.mkdir(historyFolder);
			await fs.writeFile(indexFile, JSON.stringify([]));
		}

		const rpc = harness.getPlugin<RPCPlugin>("rpc");
		this.#rpc = rpc ?? undefined;
		rpc?.register("history", {
			list: call({
				...rpcSchema.list,
				call: async () => ({ sessions: await this.list() }),
			}),
			load: call({
				...rpcSchema.load,
				call: async ({ id }) => {
					const agent = await this.loadAgent(id);
					return { id: agent.id };
				},
			}),
		});

		// register web components
		const web = harness.getPlugin("web") as WebPlugin | undefined;
		if (web) {
			const dir = import.meta.dirname!;
			web.register("history", [
				{ tag: "tame-history", src: web.resolve(dir, "./web/history.ts") },
				{ tag: "tame-history-session-title", src: web.resolve(dir, "./web/session-title.ts") },
			], [
				{ location: "panel:sidebar", tag: "tame-history" },
				{ location: "topbar:center", tag: "tame-history-session-title" },
			], web.resolve(dir, "./web/history.css"));
		}
	}

	newAgent(agent: IAgent) {
		agent.after("userMessage", async (e) => {
			const hist = getAgentHistory(agent);
			if (!hist.title) {
				const text = e.msg.content.filter(c => c.type === "text").map(c => c.text).join("");
				if (text.length > 0) {
					const nl = text.indexOf("\n");
					hist.title = nl !== -1 ? text.substring(0, nl) : text;
				}
			}
			await this.saveAgent(agent);
			return e;
		});
		agent.after("assistantMessage", async (e) => {
			await this.saveAgent(agent);
			return e;
		});
		agent.after("toolResult", async (e) => {
			await this.saveAgent(agent);
			return e;
		});
	}

	addHook<T>(key: string, hook: HistoryHook<T>): void {
		if (this.#hooks.has(key))
			throw new Error(`duplicate history hook key '${key}'`);
		this.#hooks.set(key, hook);
	}

	async saveAgent(agent: IAgent) {
		const data = getAgentHistory(agent);
		const now = Date.now();
		data.lastMessageAt = now;
		const path = resolve(historyFolder, agent.id);
		const history: History = {
			id: agent.id,
			system: agent.system,
			context: agent.context.map(messageToPersisted),
			history: data.history.map(messageToPersisted),
			extra: Object.fromEntries(this.#hooks.entries().map(([k,v]) => [k, v.save(agent)])),
			lastMessageAt: now,
		};
		await fs.writeFile(path, JSON.stringify(history), { encoding: "utf-8" });
		await this.updateIndex(agent);
	}

	async updateIndex(...agents: IAgent[]) {
		const data = await fs.readFile(indexFile, { encoding: "utf-8" });
		const index: SessionInfo[] = JSON.parse(data);
		for (const agent of agents) {
			const ad = getAgentHistory(agent);
			const s = index.find(s => s.id === agent.id);
			if (s) {
				s.title = ad.title;
				s.lastMessageAt = ad.lastMessageAt;
			} else {
				index.push({ id: agent.id, title: ad.title, lastMessageAt: ad.lastMessageAt });
			}
		}
		await fs.writeFile(indexFile, JSON.stringify(index), { encoding: "utf-8" });
		this.#emitSessionsChanged(index);
	}

	async list(): Promise<SessionInfo[]> {
		const data = await fs.readFile(indexFile, { encoding: "utf-8" });
		const index: SessionInfo[] = JSON.parse(data);
		const files = await fs.readdir(historyFolder, { withFileTypes: true });
		for (const file of files)
			if (file.isFile() && file.name !== "index.json" && !index.find(s => s.id === file.name))
				index.push({ id: file.name });

		// fallback: use file mtime for sessions missing lastMessageAt (pre-feature sessions)
		await Promise.all(index.map(async (s) => {
			if (s.lastMessageAt != null) return;
			try {
				const stat = await fs.stat(resolve(historyFolder, s.id));
				s.lastMessageAt = stat.mtimeMs;
			} catch {
				s.lastMessageAt = 0;
			}
		}));

		return index;
	}

	async load(id: string): Promise<History> {
		const json = await fs.readFile(resolve(historyFolder, id), { encoding: "utf-8" });
		const data: PersistedHistory = JSON.parse(json);
		return {
			...data,
			context: data.context.map(messageFromPersisted),
			history: data.history.map(messageFromPersisted),
		};
	}

	async loadAgent(id: string): Promise<IAgent> {
		const existing = this.#harness?.getAgent(id);
		if (existing) return existing;
		const agent = await this.historyToAgent(await this.load(id));
		await this.#emitSessionsChanged(await this.list());
		return agent;
	}

	async #emitSessionsChanged(sessions: SessionInfo[]) {
		this.#rpc?.emit({ type: "event", plugin: "history", event: "sessionsChanged", data: { sessions } });
	}

	async historyToAgent(history: History): Promise<IAgent> {
		const agent = this.#harness!.newAgent(undefined, history.system, history.id);
		agent.context = history.context;
		Object.assign(getAgentHistory(agent), {
			title: history.title,
			history: history.history,
			lastMessageAt: history.lastMessageAt,
		} as HistoryAgentData);

		for (const [k,v] of Object.entries(history.extra ?? {})) {
			const hook = this.#hooks.get(k);
			if (!hook) {
				console.warn(`extra data '${k}' in history for agent but hook not found`)
				continue;
			}
			hook.load(agent, v);
		}

		await this.updateIndex(agent);
		return agent;
	}
}
