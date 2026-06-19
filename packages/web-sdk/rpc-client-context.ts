import { createContext } from "@lit/context";

/** Minimal interface for the RPC client, so web-sdk doesn't depend on
 *  @tame/rpc-client. The transport implementation lives in plugin-web. */
export interface RPCClientLike {
	call(plugin: string, method: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
	subscribe(
		filter: { agent_id?: string; plugin?: string; event?: string },
		callback: (msg: { data: object }) => void,
	): () => void;
	emit(agentId: string, event: string, data: Record<string, unknown>): void;
}

/** Raw RPC client. Provided by shell-app after WebSocket connection.
 *  Plugin components use this to call their own plugin's RPC methods. */
export const rpcClientContext = createContext<RPCClientLike | null>(
	Symbol("rpcClient"),
);
