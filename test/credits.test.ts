import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCredits, formatUsd, parseCreditsPayload } from "../src/credits.js";
import { HYPERCREDITS_PER_USD, USD_PER_HYPERCREDIT } from "../src/hyper.js";

describe("Hypercredits Parser and Formatter", () => {
	it("parses balance in credits correctly", () => {
		const payload = { balance: 100 };
		const balance = parseCreditsPayload(payload);
		assert.equal(balance, 100);
	});

	it("parses fractional balance in credits correctly", () => {
		const payload = { balance: 183.42 };
		const balance = parseCreditsPayload(payload);
		assert.equal(balance, 183.42);
	});

	it("parses balance_usd and converts to Hypercredits", () => {
		const payload = { balance_usd: 5.0 };
		const balance = parseCreditsPayload(payload);
		assert.equal(balance, 5.0 * HYPERCREDITS_PER_USD);
	});

	it("throws on invalid payload", () => {
		assert.throws(() => parseCreditsPayload({ invalid: true }));
		assert.throws(() => parseCreditsPayload(null));
		assert.throws(() => parseCreditsPayload("not json"));
	});

	it("formats integer credits without unnecessary decimals", () => {
		assert.equal(formatCredits(100), "100");
		assert.equal(formatCredits(1000), "1,000");
	});

	it("formats fractional credits with up to 2 decimal places", () => {
		assert.equal(formatCredits(183.42), "183.42");
		assert.equal(formatCredits(64.1), "64.10");
	});

	it("formats USD equivalent properly", () => {
		const balance = 183.42;
		const usd = balance * USD_PER_HYPERCREDIT;
		assert.equal(formatUsd(usd), "$9.17");
		assert.equal(formatUsd(100 * USD_PER_HYPERCREDIT), "$5.00");
	});
});
