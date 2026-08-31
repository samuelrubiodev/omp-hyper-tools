import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AutocompleteProvider,
	createHyperAutocompleteProvider,
	getHyperArgumentCompletions,
	getHyperAutocompleteSuggestions,
	getHyperStatusArgumentCompletions,
} from "../src/autocomplete.js";

describe("Hyper Autocomplete Provider", () => {
	it("suggests all /hyper subcommands when space is typed after /hyper", () => {
		const suggestions = getHyperAutocompleteSuggestions("/hyper ");
		assert.ok(suggestions);
		assert.equal(suggestions.prefix, "");
		const values = suggestions.items.map((i) => i.value);
		assert.deepEqual(values, ["credits", "requests", "stats", "refresh", "status", "help"]);
	});

	it("filters /hyper subcommands based on typed prefix", () => {
		const suggestions = getHyperAutocompleteSuggestions("/hyper cr");
		assert.ok(suggestions);
		assert.equal(suggestions.prefix, "cr");
		assert.equal(suggestions.items.length, 1);
		assert.equal(suggestions.items[0].value, "credits");
	});

	it("filters /hyper requests and refresh based on re", () => {
		const suggestions = getHyperAutocompleteSuggestions("/hyper re");
		assert.ok(suggestions);
		assert.equal(suggestions.prefix, "re");
		const values = suggestions.items.map((i) => i.value);
		assert.deepEqual(values, ["requests", "refresh"]);
	});

	it("suggests status options when typing /hyper status ", () => {
		const suggestions = getHyperAutocompleteSuggestions("/hyper status ");
		assert.ok(suggestions);
		assert.equal(suggestions.prefix, "");
		const values = suggestions.items.map((i) => i.value);
		assert.deepEqual(values, ["teamName", "hypercredits", "reset"]);
	});

	it("suggests boolean values for /hyper status teamName ", () => {
		const suggestions = getHyperAutocompleteSuggestions("/hyper status teamName ");
		assert.ok(suggestions);
		assert.equal(suggestions.prefix, "");
		const values = suggestions.items.map((i) => i.value);
		assert.deepEqual(values, ["true", "false"]);
	});

	it("suggests options for legacy alias /hyper-status ", () => {
		const suggestions = getHyperAutocompleteSuggestions("/hyper-status ");
		assert.ok(suggestions);
		const values = suggestions.items.map((i) => i.value);
		assert.deepEqual(values, ["teamName", "hypercredits", "reset"]);
	});

	it("provides argument completions for registerCommand getArgumentCompletions", () => {
		const completions = getHyperArgumentCompletions("");
		assert.ok(completions);
		const values = completions.map((c) => c.value);
		assert.deepEqual(values, ["credits", "requests", "stats", "refresh", "status", "help"]);

		const creditMatch = getHyperArgumentCompletions("cr");
		assert.ok(creditMatch);
		assert.equal(creditMatch[0].value, "credits");

		const statusSub = getHyperArgumentCompletions("status ");
		assert.ok(statusSub);
		assert.deepEqual(
			statusSub.map((s) => s.value),
			["status teamName", "status hypercredits", "status reset"],
		);

		const statusBool = getHyperArgumentCompletions("status teamName ");
		assert.ok(statusBool);
		assert.deepEqual(
			statusBool.map((s) => s.value),
			["status teamName true", "status teamName false"],
		);
	});

	it("provides argument completions for hyper-status", () => {
		const completions = getHyperStatusArgumentCompletions("");
		assert.ok(completions);
		assert.deepEqual(
			completions.map((c) => c.value),
			["teamName", "hypercredits", "reset"],
		);

		const boolCompletions = getHyperStatusArgumentCompletions("teamName ");
		assert.ok(boolCompletions);
		assert.deepEqual(
			boolCompletions.map((c) => c.value),
			["teamName true", "teamName false"],
		);
	});

	it("returns undefined when line is not a /hyper command", () => {
		assert.equal(getHyperAutocompleteSuggestions("hello world"), undefined);
		assert.equal(getHyperAutocompleteSuggestions("/other command"), undefined);
	});

	it("delegates to current provider when no hyper suggestions match", async () => {
		let fallbackCalled = false;
		const mockBaseProvider: AutocompleteProvider = {
			getSuggestions(_lines, _cursorLine, _cursorCol, _options) {
				fallbackCalled = true;
				return Promise.resolve({ items: [{ value: "fallback", label: "fallback" }], prefix: "" });
			},
			applyCompletion(lines, cursorLine, cursorCol) {
				return { lines, cursorLine, cursorCol };
			},
		};

		const provider = createHyperAutocompleteProvider(mockBaseProvider);
		const result = await provider.getSuggestions(["git status"], 0, 10, {
			signal: new AbortController().signal,
		});

		assert.ok(fallbackCalled);
		assert.equal(result?.items[0].value, "fallback");
	});
});
