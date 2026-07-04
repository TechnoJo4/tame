// Re-export from web-sdk so shell components and plugin components
// share the same context symbols. The symbols must be identical
// across the shell bundle and plugin bundles -- a locally created
// Symbol() in each bundle would be a different key.
export {
	settingsPluginIdContext,
	settingsStoreContext,
} from "@tame/web-sdk/settings-context";
