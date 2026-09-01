export type MessageVisibility =|"shown"|"hidden"|"collapsable"|"collapsed";

export const AUTOMATED_VISIBILITY_KEY = "automatedVisibility";
export const DEFAULT_AUTOMATED_VISIBILITY: MessageVisibility = "hidden";

export function parseMessageVisibility(raw: string|null): MessageVisibility {
	switch (raw) {
	case "shown":
	case "hidden":
	case "collapsable":
	case "collapsed":
		return raw;
	default:
		return DEFAULT_AUTOMATED_VISIBILITY;
	}
}
