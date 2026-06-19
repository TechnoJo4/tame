/** Generic key-value store for plugin settings.
 *  Backed by localStorage. Values are JSON-encoded.
 *  onChange returns an unsubscribe function. */
export interface SettingsStore {
	get(pluginId: string, key: string): string | null;
	set(pluginId: string, key: string, value: string): void;
	onChange(pluginId: string, key: string,
		callback: (value: string | null) => void): () => void;
}
