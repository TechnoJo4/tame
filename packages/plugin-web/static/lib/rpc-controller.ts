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

interface Message {
	role: "user" | "assistant";
	content: ContentBlock[];
}

type ContentBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

export class RPCController {
	host: any;

	messages: Message[] = [];
	loading = true;
	error: string | null = null;
	registry: Registry | null = null;
	agentId: string | null = null;

	#client: RPCClient | null = null;
	#unsubs: (() => void)[] = [];

	constructor(host: any) {
		this.host = host;
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
			this.loading = false;
			this.host.requestUpdate();

			this.#subscribe();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.loading = false;
			this.host.requestUpdate();
		}
	}

	#subscribe() {
		if (!this.#client || !this.agentId) return;

		this.#unsubs.push(
			this.#client.subscribe({ agent_id: this.agentId }, (msg) => {
				switch (msg.event) {
					case "userMessage":
						this.#handleUserMessage(msg.data as any);
						break;
					case "assistantMessage":
						this.#handleAssistantMessage(msg.data as any);
						break;
					case "toolResult":
						this.#handleToolResult(msg.data as any);
						break;
				}
				this.host.requestUpdate();
			}),
		);
	}

	#handleUserMessage(data: { msg: any }) {
		const blocks: ContentBlock[] = [];
		for (const c of data.msg.content) {
			if (c.type === "text") {
				blocks.push({ type: "text", text: c.text });
			}
		}
		this.messages = [...this.messages, { role: "user", content: blocks }];
	}

	#handleAssistantMessage(data: { msg: any }) {
		const blocks: ContentBlock[] = [];
		for (const c of data.msg.content) {
			if (c.type === "text") {
				blocks.push({ type: "text", text: c.text });
			} else if (c.type === "thinking") {
				blocks.push({ type: "thinking", thinking: c.thinking });
			} else if (c.type === "tool_use") {
				blocks.push({
					type: "tool_use",
					id: c.id,
					name: c.name,
					input: c.input as Record<string, unknown>,
				});
			}
		}
		this.messages = [...this.messages, { role: "assistant", content: blocks }];
	}

	#handleToolResult(data: { toolUse: string; error: boolean; result: string }) {
		this.messages = [...this.messages, {
			role: "user",
			content: [{
				type: "tool_result",
				tool_use_id: data.toolUse,
				content: data.result,
				is_error: data.error,
			}],
		}];
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
