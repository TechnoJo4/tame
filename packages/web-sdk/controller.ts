/** Interface for the web RPC controller, exposed to plugin frontend components.
 *  Components receive this as their `.controller` property. */
export interface WebController {
	/** Switch the displayed thread to a different agent. */
	switchAgent(id: string): Promise<void>;

	/** Create a fresh agent and switch to it. */
	newChat(system?: string): Promise<void>;

	/** The raw RPC client, for calling plugin-specific RPC methods
	 *  and subscribing to plugin events. */
	readonly client: {
		call(plugin: string, method: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
		subscribe(filter: { agent_id?: string; plugin?: string; event?: string }, callback: (msg: { data: object }) => void): () => void;
	} | null;
}

/** Generic key-value store for plugin settings.
 *  Backed by localStorage. Values are JSON-encoded.
 *  onChange returns an unsubscribe function. */
export interface SettingsStore {
	get(pluginId: string, key: string): string | null;
	set(pluginId: string, key: string, value: string): void;
	onChange(pluginId: string, key: string,
		callback: (value: string | null) => void): () => void;
}
