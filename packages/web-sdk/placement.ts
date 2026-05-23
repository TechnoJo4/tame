export interface ComponentDef {
	tag: string;
	src: string; // absolute filesystem path, .ts or .js
}

export interface Placement {
	location: string;
	tag: string;
	props?: Record<string, unknown>;
}
