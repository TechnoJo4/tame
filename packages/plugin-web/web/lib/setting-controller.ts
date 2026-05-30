import type { ReactiveController, ReactiveControllerHost } from "lit";
import { ContextEvent } from "@lit/context";
import { settingsStoreContext } from "./settings-context.ts";
import type { SettingsStore } from "@tame/web-sdk";

/** One instance per setting field. Handles get/set/subscribe/unsubscribe.
 *  Pulls the SettingsStore from the host element's context.
 *  Calls host.requestUpdate() automatically on change. */
export class SettingController implements ReactiveController {
	#host: ReactiveControllerHost & HTMLElement;
	#pluginId: string;
	#key: string;
	#defaultValue: string;
	#store: SettingsStore | null = null;
	#unsub: (() => void) | null = null;

	constructor(
		host: ReactiveControllerHost & HTMLElement,
		pluginId: string,
		key: string,
		defaultValue: string,
	) {
		this.#host = host;
		this.#pluginId = pluginId;
		this.#key = key;
		this.#defaultValue = defaultValue;
		host.addController(this);
	}

	hostConnected() {
		// Request the store from context
		this.#host.dispatchEvent(
			new ContextEvent(
				settingsStoreContext,
				this.#host,
				(store: SettingsStore) => {
					this.#store = store;
					this.#unsub = store.onChange(
						this.#pluginId,
						this.#key,
						() => this.#host.requestUpdate(),
					);
				},
			),
		);
	}

	hostDisconnected() {
		this.#unsub?.();
		this.#unsub = null;
		this.#store = null;
	}

	// ---- raw value accessors ----

	get value(): string | null {
		return this.#store?.get(this.#pluginId, this.#key) ?? this.#defaultValue;
	}
	set value(v: string | null) {
		this.#store?.set(this.#pluginId, this.#key, v ?? this.#defaultValue);
	}

	// ---- boolean accessors ----

	get bool(): boolean {
		const raw = this.#store?.get(this.#pluginId, this.#key);
		if (raw === null || raw === undefined) return this.#defaultValue === "true";
		try {
			return JSON.parse(raw) === true;
		} catch {
			return this.#defaultValue === "true";
		}
	}
	set bool(v: boolean) {
		this.#store?.set(
			this.#pluginId,
			this.#key,
			JSON.stringify(v),
		);
	}
	toggle(): void {
		this.bool = !this.bool;
	}

	// ---- number accessors ----

	get num(): number {
		const raw = this.#store?.get(this.#pluginId, this.#key);
		if (raw === null || raw === undefined) return Number(this.#defaultValue);
		try {
			const n = JSON.parse(raw);
			return typeof n === "number" && !Number.isNaN(n)
				? n
				: Number(this.#defaultValue);
		} catch {
			return Number(this.#defaultValue);
		}
	}
	set num(v: number) {
		this.#store?.set(this.#pluginId, this.#key, JSON.stringify(v));
	}

	// ---- JSON accessor ----

	get json(): unknown {
		const raw = this.#store?.get(this.#pluginId, this.#key);
		if (raw === null || raw === undefined) {
			try { return JSON.parse(this.#defaultValue); } catch { return null; }
		}
		try { return JSON.parse(raw); } catch { return null; }
	}
	set json(v: unknown) {
		this.#store?.set(this.#pluginId, this.#key, JSON.stringify(v));
	}
}
