import type { SettingsStore } from "@tame/web-sdk";

const PREFIX = "tame:settings:";
const EVENT = "tame:settings-changed";

function encodeKey(pluginId: string, key: string): string {
	return `${PREFIX}${pluginId}.${key}`;
}

function decodeKey(full: string): { pluginId: string; key: string } | null {
	if (!full.startsWith(PREFIX)) return null;
	const rest = full.slice(PREFIX.length);
	const dot = rest.indexOf(".");
	if (dot === -1) return null;
	return { pluginId: rest.slice(0, dot), key: rest.slice(dot + 1) };
}

export class LocalSettingsStore implements SettingsStore {
	#listeners: Array<
		{ pluginId: string; key: string; callback: (value: string | null) => void }
	> = [];

	constructor() {
		// cross-tab sync: browser storage event → re-dispatch as CustomEvent
		addEventListener("storage", (e: StorageEvent) => {
			if (!e.key) return;
			const decoded = decodeKey(e.key);
			if (!decoded) return;
			const detail = {
				pluginId: decoded.pluginId,
				key: decoded.key,
				value: e.newValue !== null ? JSON.parse(e.newValue) : null,
			};
			document.dispatchEvent(
				new CustomEvent(EVENT, { detail }),
			);
		});
	}

	get(pluginId: string, key: string): string | null {
		const raw = localStorage.getItem(encodeKey(pluginId, key));
		if (raw === null) return null;
		try {
			return JSON.stringify(JSON.parse(raw));
		} catch {
			return null;
		}
	}

	set(pluginId: string, key: string, value: string): void {
		const encoded = JSON.stringify(JSON.parse(value)); // normalize: re-encode so stored value is always valid JSON
		localStorage.setItem(encodeKey(pluginId, key), encoded);
		const detail = { pluginId, key, value };
		document.dispatchEvent(
			new CustomEvent(EVENT, { detail }),
		);
	}

	onChange(
		pluginId: string,
		key: string,
		callback: (value: string | null) => void,
	): () => void {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent).detail as {
				pluginId: string; key: string; value: unknown;
			};
			if (detail.pluginId === pluginId && detail.key === key) {
				callback(
					detail.value !== null ? JSON.stringify(detail.value) : null,
				);
			}
		};
		document.addEventListener(EVENT, handler);
		return () => document.removeEventListener(EVENT, handler);
	}
}
