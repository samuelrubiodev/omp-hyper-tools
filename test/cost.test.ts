import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HYPERCREDITS_PER_USD } from "../src/hyper.js";
import { calculateCacheHitRate, calculateEstimatedCost, type ModelPricingRates } from "../src/tracking.js";

describe("Cost and Cache Calculations", () => {
	const rates: ModelPricingRates = {
		input: 0.44, // $0.44 per 1M uncached input tokens
		output: 1.32, // $1.32 per 1M output tokens
		cacheRead: 0.044, // $0.044 per 1M cached tokens (hit)
		cacheWrite: 0.1, // $0.10 per 1M cache write tokens
	};

	it("calculates cost for uncached input and output", () => {
		const usage = {
			inputTokens: 1_000_000,
			cachedTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 1_000_000,
		};

		const result = calculateEstimatedCost(rates, usage);

		assert.equal(result.inputCostUsd, 0.44);
		assert.equal(result.outputCostUsd, 1.32);
		assert.equal(result.cacheReadCostUsd, 0);
		assert.equal(result.cacheWriteCostUsd, 0);
		assert.equal(result.costUsd, 1.76);
		assert.equal(result.costHc, 1.76 * HYPERCREDITS_PER_USD);
	});

	it("calculates cost with cached tokens and cache write tokens", () => {
		const usage = {
			inputTokens: 100_000, // 0.1M * 0.44 = 0.044
			cachedTokens: 900_000, // 0.9M * 0.044 = 0.0396
			cacheWriteTokens: 50_000, // 0.05M * 0.10 = 0.005
			outputTokens: 10_000, // 0.01M * 1.32 = 0.0132
		};

		const result = calculateEstimatedCost(rates, usage);

		assert.ok(Math.abs(result.inputCostUsd - 0.044) < 1e-6);
		assert.ok(Math.abs(result.cacheReadCostUsd - 0.0396) < 1e-6);
		assert.ok(Math.abs(result.cacheWriteCostUsd - 0.005) < 1e-6);
		assert.ok(Math.abs(result.outputCostUsd - 0.0132) < 1e-6);

		const expectedUsd = 0.044 + 0.0396 + 0.005 + 0.0132;
		assert.ok(Math.abs(result.costUsd - expectedUsd) < 1e-6);
		assert.ok(Math.abs(result.costHc - expectedUsd * HYPERCREDITS_PER_USD) < 1e-6);
	});

	it("handles undefined rates gracefully", () => {
		const result = calculateEstimatedCost(undefined, {
			inputTokens: 1000,
			cachedTokens: 500,
			outputTokens: 200,
		});

		assert.equal(result.costUsd, 0);
		assert.equal(result.costHc, 0);
	});

	it("calculates cache hit rate correctly", () => {
		// 900 cached out of 1000 total input = 90%
		const hitRate = calculateCacheHitRate(900, 100);
		assert.equal(hitRate, 0.9);

		// 174,912 cached out of 183,421 total input (174,912 + 8,509)
		const hitRate2 = calculateCacheHitRate(174912, 8509);
		assert.ok(Math.abs(hitRate2 - 0.9536) < 1e-3);
	});

	it("returns 0 cache hit rate when there are zero tokens", () => {
		assert.equal(calculateCacheHitRate(0, 0), 0);
	});
});
