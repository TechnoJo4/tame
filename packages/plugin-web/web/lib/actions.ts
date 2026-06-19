import type { RPCClientLike } from "@tame/web-sdk/rpc-client-context";

/** Send a user message to the active agent. Emits the userMessage event
 *  over RPC so the server-side agent processes it. */
export function send(client: RPCClientLike, agentId: string, text: string): void {
	client.emit(agentId, "userMessage", {
		msg: { role: "user", content: [{ type: "text", text }] },
	});
}

/** Abort the currently running agent turn. */
export function abort(client: RPCClientLike, agentId: string): void {
	client.call("@tame", "abort", { id: agentId });
}

/** Create a fresh agent and return its id. */
export async function newAgent(
	client: RPCClientLike,
	system?: string,
): Promise<string> {
	const result = await client.call("@tame", "newAgent", { system: system ?? null } as any);
	return (result as any).id as string;
}
