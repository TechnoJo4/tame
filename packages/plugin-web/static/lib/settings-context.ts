import { createContext } from "@lit/context";
import type { SettingsStore } from "@tame/web-sdk";

/** Root context: provided by <tame-web-shell>, consumed by all settings components. */
export const settingsStoreContext = createContext<SettingsStore>(
	Symbol("settingsStore"),
);

/** Form-level context: provided by <tame-web-settings-form>,
 *  consumed by convenience elements within that form. */
export const settingsPluginIdContext = createContext<string>(
	Symbol("settingsPluginId"),
);
