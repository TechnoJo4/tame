import { RPCClient } from "./rpc-client.ts";
import { wsToStream } from "./stream.ts";

interface ComponentEntry {
	src: string;
}

interface Registry {
	components: Record<string, ComponentEntry>;
	placements: Placement[];
}

interface Placement {
	location: string;
	tag: string;
	props?: Record<string, unknown>;
}

export interface Message {
	role: "user" | "assistant";
	content: ContentBlock[];
}

export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

interface TameShellHost {
	messages: Message[];
	loading: boolean;
	error: string | null;
	addController(c: RPCController): void;
	requestUpdate(): void;
}

export class RPCController {
	#host: TameShellHost;
	#client: RPCClient | null = null;
	#unsubs: (() => void)[] = [];

	registry: Registry | null = null;
	agentId: string | null = null;

	constructor(host: TameShellHost) {
		this.#host = host;
		host.addController(this);
	}

	hostConnected() {
		this.#connect();
	}

	hostDisconnected() {
		this.#client?.close();
		for (const unsub of this.#unsubs) unsub();
	}

	async #connect() {
		try {
			const ws = new WebSocket(`ws://${location.host}`);
			const stream = wsToStream(ws);
			this.#client = new RPCClient(stream);

			const [registry, agent] = await Promise.all([
				this.#client.call("web", "getRegistry", {}),
				this.#client.newAgent(),
			]);

			this.registry = registry as unknown as Registry;
			this.agentId = agent.id;
			this.#host.loading = false;
			this.#subscribe();
		} catch (e) {
			this.#host.error = e instanceof Error ? e.message : String(e);
			this.#host.loading = false;
		}
	}

	#subscribe() {
		if (!this.#client || !this.agentId) return;

		const on = (event: string, handler: (data: Record<string, unknown>) => void) => {
			this.#unsubs.push(
				this.#client.subscribe({ agent_id: this.agentId, event }, (msg) =>
					handler(msg.data as Record<string, unknown>),
				),
			);
		};

		on("userMessage", (d) => this.#host.messages = [...this.#host.messages, userMessage(d)]);
		on("assistantMessage", (d) => this.#host.messages = [...this.#host.messages, assistantMessage(d)]);
		on("toolResult", (d) => this.#host.messages = [...this.#host.messages, toolResultMessage(d)]);
	}

	send(text: string) {
		if (!this.#client || !this.agentId) return;
		this.#client.emit(this.agentId, "userMessage", {
			msg: { role: "user", content: [{ type: "text", text }] },
		});
	}

	async viewToolCall(toolUseId: string): Promise<{ tag: string; props: Record<string, unknown> } | null> {
		if (!this.#client || !this.agentId) return null;
		try {
			const result = await this.#client.viewToolCall(this.agentId, toolUseId, "web");
			return result as { tag: string; props: Record<string, unknown> } | null;
		} catch {
			return null;
		}
	}

	getPlacements(location: string): Placement[] {
		if (!this.registry) return [];
		return this.registry.placements.filter((p) => p.location === location);
	}

	getComponentSrc(tag: string): string | undefined {
		return this.registry?.components[tag]?.src;
	}
}

// ---- message constructors (pure functions, no 'this') ----

function userMessage(data: { msg: { content: { type: string; text?: string }[] } }): Message {
	const blocks: ContentBlock[] = [];
	for (const c of data.msg.content) {
		if (c.type === "text") blocks.push({ type: "text", text: c.text! });
	}
	return { role: "user", content: blocks };
}

function assistantMessage(data: { msg: { content: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }[] } }): Message {
	const blocks: ContentBlock[] = [];
	for (const c of data.msg.content) {
		if (c.type === "text") {
			blocks.push({ type: "text", text: c.text! });
		} else if (c.type === "thinking") {
			blocks.push({ type: "thinking", thinking: c.thinking! });
		} else if (c.type === "tool_use") {
			blocks.push({ type: "tool_use", id: c.id!, name: c.name!, input: c.input! });
		}
	}
	return { role: "assistant", content: blocks };
}

function toolResultMessage(data: { toolUse: string; error: boolean; result: string }): Message {
	return {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: data.toolUse, content: data.result, is_error: data.error }],
	};
}
