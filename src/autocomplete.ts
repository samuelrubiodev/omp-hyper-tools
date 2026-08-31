export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

export interface AutocompleteSuggestions {
	items: AutocompleteItem[];
	prefix: string;
}

export interface AutocompleteOptions {
	signal: AbortSignal;
	force?: boolean;
}

export interface AutocompleteProvider {
	triggerCharacters?: string[];
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: AutocompleteOptions,
	): Promise<AutocompleteSuggestions | null>;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

export const HYPER_SUBCOMMANDS: AutocompleteItem[] = [
	{
		value: "credits",
		label: "credits",
		description: "Show real Hypercredit balance and USD equivalent",
	},
	{
		value: "requests",
		label: "requests",
		description: "Show local request counts vs hourly/daily Shred limits",
	},
	{
		value: "stats",
		label: "stats",
		description: "Show token usage, cache hit rate, and estimated costs",
	},
	{
		value: "refresh",
		label: "refresh",
		description: "Force fresh update of credits and model pricing catalogs",
	},
	{
		value: "status",
		label: "status",
		description: "Configure footer status line items",
	},
	{
		value: "help",
		label: "help",
		description: "Show help overview for /hyper commands",
	},
];

export const STATUS_SUBCOMMANDS: AutocompleteItem[] = [
	{
		value: "teamName",
		label: "teamName",
		description: "Toggle displaying team name in status line (true/false)",
	},
	{
		value: "hypercredits",
		label: "hypercredits",
		description: "Toggle displaying Hypercredit balance in status line (true/false)",
	},
	{
		value: "reset",
		label: "reset",
		description: "Reset status line settings to default values",
	},
];

export const BOOLEAN_OPTIONS: AutocompleteItem[] = [
	{
		value: "true",
		label: "true",
		description: "Enable in status line",
	},
	{
		value: "false",
		label: "false",
		description: "Disable in status line",
	},
];

export function filterItems(items: AutocompleteItem[], query: string): AutocompleteItem[] {
	const lower = query.toLowerCase();
	if (!lower) return items;
	return items.filter((item) => item.value.toLowerCase().startsWith(lower));
}

/**
 * Argument completion handler for `pi.registerCommand("hyper", { getArgumentCompletions })`.
 */
export function getHyperArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const trimmed = argumentPrefix.trimStart();

	// Check if user is typing /hyper status ...
	if (/^status\s+/i.test(trimmed)) {
		const rest = trimmed.replace(/^status\s+/i, "");
		if (/^(?:teamName|hypercredits)\s+/i.test(rest)) {
			const boolPrefix = rest.replace(/^(?:teamName|hypercredits)\s+/i, "").toLowerCase();
			const param = rest.split(/\s+/)[0];
			const matches = BOOLEAN_OPTIONS.filter((o) => o.value.startsWith(boolPrefix)).map((o) => ({
				value: `status ${param} ${o.value}`,
				label: o.label,
				description: o.description,
			}));
			return matches.length > 0 ? matches : null;
		}

		const subToken = rest.toLowerCase();
		const matches = STATUS_SUBCOMMANDS.filter((s) => s.value.toLowerCase().startsWith(subToken)).map((s) => ({
			value: `status ${s.value}`,
			label: s.label,
			description: s.description,
		}));
		return matches.length > 0 ? matches : null;
	}

	const token = trimmed.toLowerCase();
	const filtered = HYPER_SUBCOMMANDS.filter((s) => s.value.toLowerCase().startsWith(token));
	return filtered.length > 0 ? filtered : null;
}

/**
 * Argument completion handler for `pi.registerCommand("hyper-status", { getArgumentCompletions })`.
 */
export function getHyperStatusArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const trimmed = argumentPrefix.trimStart();
	if (/^(?:teamName|hypercredits)\s+/i.test(trimmed)) {
		const boolPrefix = trimmed.replace(/^(?:teamName|hypercredits)\s+/i, "").toLowerCase();
		const param = trimmed.split(/\s+/)[0];
		const matches = BOOLEAN_OPTIONS.filter((o) => o.value.startsWith(boolPrefix)).map((o) => ({
			value: `${param} ${o.value}`,
			label: o.label,
			description: o.description,
		}));
		return matches.length > 0 ? matches : null;
	}
	const token = trimmed.toLowerCase();
	const filtered = STATUS_SUBCOMMANDS.filter((s) => s.value.toLowerCase().startsWith(token));
	return filtered.length > 0 ? filtered : null;
}

/**
 * Returns autocomplete suggestions if the cursor is preceded by `/hyper ...` or `/hyper-status ...`.
 */
export function getHyperAutocompleteSuggestions(textBeforeCursor: string): AutocompleteSuggestions | undefined {
	// Match /hyper status teamName/hypercredits <val>
	const statusBoolMatch = textBeforeCursor.match(
		/^\s*(?:\/hyper\s+status|\/hyper-status)\s+(?:teamName|hypercredits)\s+([^\s]*)$/i,
	);
	if (statusBoolMatch) {
		const token = statusBoolMatch[1] ?? "";
		const items = filterItems(BOOLEAN_OPTIONS, token);
		return { prefix: token, items };
	}

	// Match /hyper status <subcommand> or /hyper-status <subcommand>
	const statusSubMatch = textBeforeCursor.match(/^\s*(?:\/hyper\s+status|\/hyper-status)\s+([^\s]*)$/i);
	if (statusSubMatch) {
		const token = statusSubMatch[1] ?? "";
		const items = filterItems(STATUS_SUBCOMMANDS, token);
		return { prefix: token, items };
	}

	// Match /hyper <subcommand>
	const hyperSubMatch = textBeforeCursor.match(/^\s*\/hyper\s+([^\s]*)$/i);
	if (hyperSubMatch) {
		const token = hyperSubMatch[1] ?? "";
		const items = filterItems(HYPER_SUBCOMMANDS, token);
		return { prefix: token, items };
	}

	return undefined;
}

/**
 * Creates an AutocompleteProvider that layers /hyper subcommands over the current provider.
 */
export function createHyperAutocompleteProvider(current: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const currentLine = lines[cursorLine] ?? "";
			const textBeforeCursor = currentLine.slice(0, cursorCol);

			const suggestions = getHyperAutocompleteSuggestions(textBeforeCursor);
			if (suggestions) {
				return suggestions;
			}

			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (current.applyCompletion) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const after = line.slice(cursorCol);
			const newLine = `${before}${item.value}${after}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: before.length + item.value.length,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
