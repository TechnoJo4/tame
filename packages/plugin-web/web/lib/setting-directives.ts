import { Directive, directive } from "lit/directive.js";
import { AsyncDirective } from "lit/async-directive.js";
import { ContextEvent } from "@lit/context";
import { settingsStoreContext } from "./settings-context.ts";
import type { SettingsStore } from "@tame/web-sdk";

// ---- base: resolves SettingsStore from context once, subscribes, tears down ----

abstract class SettingDirective<T> extends AsyncDirective {
	#store: SettingsStore | null = null;
	#unsub: (() => void) | null = null;
	#pluginId = "";
	#key = "";
	#defaultValue = "";

	/** Called by subclasses in render(). Dispatches a context request
	 *  to resolve the store, subscribes, and returns the coerced value. */
	protected resolve(
		pluginId: string,
		key: string,
		defaultValue: string,
	): T {
		if (this.#store === null) {
			this.#pluginId = pluginId;
			this.#key = key;
			this.#defaultValue = defaultValue;

			// part is set by lit before render() is called
			const el = (this as unknown as { part?: { options?: { host: HTMLElement } } })
				.part?.options?.host;
			if (el) {
				el.dispatchEvent(
					new ContextEvent(
						settingsStoreContext,
						el,
						(store: SettingsStore) => {
							this.#store = store;
							this.#unsub = store.onChange(
								this.#pluginId,
								this.#key,
								() => this.setValue(this.#coerce()),
							);
						},
					),
				);
			}
		}

		return this.#coerce();
	}

	protected abstract coerce(raw: string | null): T;

	#coerce(): T {
		const raw = this.#store?.get(this.#pluginId, this.#key) ?? null;
		return this.coerce(raw === null ? this.#defaultValue : raw);
	}

	protected disconnected() {
		this.#unsub?.();
		this.#unsub = null;
		this.#store = null;
	}

	protected reconnected() {
		// store is resolved synchronously on next render()
	}
}

// ---- setting() — returns JSON-parsed value ----

class Setting extends SettingDirective<unknown> {
	render(pluginId: string, key: string, defaultValue: string) {
		return this.resolve(pluginId, key, defaultValue);
	}

	protected coerce(raw: string | null): unknown {
		if (raw === null) return null;
		try { return JSON.parse(raw); } catch { return null; }
	}
}

// ---- settingBool() — boolean convenience ----

class SettingBool extends SettingDirective<boolean> {
	render(pluginId: string, key: string, defaultValue: string) {
		return this.resolve(pluginId, key, defaultValue);
	}

	protected coerce(raw: string | null): boolean {
		if (raw === null) return false;
		try { return JSON.parse(raw) === true; } catch { return false; }
	}
}

// ---- settingWhen() — conditional rendering ----

class SettingWhen extends SettingDirective<unknown> {
	#renderFn: ((value: string) => unknown) | null = null;

	render(
		pluginId: string,
		key: string,
		defaultValue: string,
		renderFn: (value: string) => unknown,
	) {
		this.#renderFn = renderFn;
		return this.resolve(pluginId, key, defaultValue);
	}

	protected coerce(raw: string | null): unknown {
		if (!this.#renderFn) return null;
		return this.#renderFn(raw ?? "");
	}
}

/** Returns the JSON-parsed value for a setting. Re-renders the binding on change. */
export const setting = directive(Setting);

/** Boolean convenience — returns boolean for lit bindings. */
export const settingBool = directive(SettingBool);

/** Conditional rendering — calls renderFn when value changes. */
export const settingWhen = directive(SettingWhen);
