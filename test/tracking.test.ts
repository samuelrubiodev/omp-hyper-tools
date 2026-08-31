import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { updateCachedHyperModels } from "../src/models.js";
import { createTracker, parseRateLimitHeaders, startOfLocalDay, startOfLocalHour } from "../src/tracking.js";

describe("Dynamic Server Rate Limits & Local Request Tracking", () => {
	it("calculates start of local hour accurately", () => {
		const d = new Date(2026, 7, 31, 14, 35, 22, 500);
		const hourStart = startOfLocalHour(d);
		const expected = new Date(2026, 7, 31, 14, 0, 0, 0).getTime();
		assert.equal(hourStart, expected);
	});

	it("calculates start of local day accurately", () => {
		const d = new Date(2026, 7, 31, 14, 35, 22, 500);
		const dayStart = startOfLocalDay(d);
		const expected = new Date(2026, 7, 31, 0, 0, 0, 0).getTime();
		assert.equal(dayStart, expected);
	});

	it("Test 1: parses standard rate limit headers", () => {
		const headers = {
			"x-ratelimit-limit-hour": "1000",
			"x-ratelimit-limit-day": "10000",
			"x-ratelimit-remaining-hour": "986",
			"x-ratelimit-remaining-day": "9976",
		};

		const parsed = parseRateLimitHeaders(headers);
		assert.equal(parsed.limitHour, 1000);
		assert.equal(parsed.limitDay, 10000);
		assert.equal(parsed.remainingHour, 986);
		assert.equal(parsed.remainingDay, 9976);
		assert.ok(parsed.lastUpdatedAt !== undefined);
	});

	it("Test 2: parses free-tier style limits without assuming Shred limits", () => {
		const headers = {
			"x-ratelimit-limit-hour": "200",
			"x-ratelimit-limit-day": "1000",
			"x-ratelimit-remaining-hour": "182",
			"x-ratelimit-remaining-day": "387",
		};

		const tracker = createTracker({ inMemory: true });
		const limits = tracker.updateServerRateLimits(headers);

		assert.equal(limits.limitHour, 200);
		assert.equal(limits.limitDay, 1000);
		assert.equal(limits.remainingHour, 182);
		assert.equal(limits.remainingDay, 387);
	});

	it("Test 3: handles mixed/missing headers and preserves previous values", () => {
		const tracker = createTracker({ inMemory: true });

		// First response with full headers
		tracker.updateServerRateLimits({
			"x-ratelimit-limit-hour": "1000",
			"x-ratelimit-limit-day": "10000",
			"x-ratelimit-remaining-hour": "950",
			"x-ratelimit-remaining-day": "9900",
		});

		// Subsequent response with only remaining-hour
		const updated = tracker.updateServerRateLimits({
			"x-ratelimit-remaining-hour": "949",
		});

		assert.equal(updated.limitHour, 1000);
		assert.equal(updated.limitDay, 10000);
		assert.equal(updated.remainingHour, 949);
		assert.equal(updated.remainingDay, 9900);
	});

	it("Test 4: parses case-insensitive header names", () => {
		const headers = {
			"X-RateLimit-Limit-Hour": "500",
			"X-RATELIMIT-LIMIT-DAY": "5000",
			"x-RateLimit-Remaining-Hour": "480",
			"X-ratelimit-REMAINING-day": "4800",
		};

		const parsed = parseRateLimitHeaders(headers);
		assert.equal(parsed.limitHour, 500);
		assert.equal(parsed.limitDay, 5000);
		assert.equal(parsed.remainingHour, 480);
		assert.equal(parsed.remainingDay, 4800);
	});

	it("Test 5: ignores malformed non-numeric values safely", () => {
		const headers = {
			"x-ratelimit-limit-hour": "invalid_number",
			"x-ratelimit-limit-day": "-50",
			"x-ratelimit-remaining-hour": "",
			"x-ratelimit-remaining-day": "100",
		};

		const parsed = parseRateLimitHeaders(headers);
		assert.equal(parsed.limitHour, undefined);
		assert.equal(parsed.limitDay, undefined);
		assert.equal(parsed.remainingHour, undefined);
		assert.equal(parsed.remainingDay, 100);
	});

	it("Test 6: persistence and restoration of server limits & records", () => {
		const tmpFile = path.join(os.tmpdir(), `hyper-test-store-${Date.now()}.json`);
		try {
			const tracker1 = createTracker({ storagePath: tmpFile });
			tracker1.updateServerRateLimits({
				"x-ratelimit-limit-hour": "200",
				"x-ratelimit-remaining-hour": "150",
			});
			tracker1.recordRequest({
				model: "deepseek-v4-flash",
				usage: { inputTokens: 50, cachedTokens: 0, outputTokens: 25 },
			});

			// Re-create tracker pointing to same file
			const tracker2 = createTracker({ storagePath: tmpFile });
			const limits = tracker2.getServerRateLimits();
			assert.equal(limits.limitHour, 200);
			assert.equal(limits.remainingHour, 150);

			const summary = tracker2.getSummary();
			assert.equal(summary.localDailyRequests, 1);
			assert.equal(summary.today.inputTokens, 50);
		} finally {
			if (fs.existsSync(tmpFile)) {
				fs.unlinkSync(tmpFile);
			}
		}
	});

	it("Test 7: inference requests increment local counter while credits/models do not", () => {
		const tracker = createTracker({ inMemory: true });

		// Initial state
		let summary = tracker.getSummary();
		assert.equal(summary.localHourlyRequests, 0);

		// Record an inference request
		tracker.recordRequest({
			model: "deepseek-v4-flash",
			usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 20 },
		});

		summary = tracker.getSummary();
		assert.equal(summary.localHourlyRequests, 1);
		assert.equal(summary.session.requests, 1);

		// Non-inference operations only update rate limits if headers arrive, but do not call recordRequest
		tracker.updateServerRateLimits({
			"x-ratelimit-remaining-hour": "199",
		});

		summary = tracker.getSummary();
		assert.equal(summary.localHourlyRequests, 1);
		assert.equal(summary.session.requests, 1);
	});

	it("Test 8: captures both estimated and server-reported actual costs independently", () => {
		updateCachedHyperModels([
			{
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				cost_per_1m_in: 0.2,
				cost_per_1m_out: 0.4,
				cost_per_1m_in_cached: 0,
				cost_per_1m_out_cached: 0.04,
				context_window: 1000000,
				default_max_tokens: 8192,
				can_reason: true,
				supports_attachments: false,
			},
		]);

		const tracker = createTracker({ inMemory: true });

		tracker.recordRequest({
			model: "deepseek-v4-flash",
			usage: {
				inputTokens: 10,
				cachedTokens: 0,
				outputTokens: 69,
				reasoningTokens: 65,
				actualCostUsd: 0.0001,
				actualCostHc: 0.002,
			},
		});

		const summary = tracker.getSummary();
		assert.equal(summary.session.requests, 1);
		assert.equal(summary.session.actualCostUsd, 0.0001);
		assert.equal(summary.session.actualCostHc, 0.002);
		assert.ok(summary.session.costUsd > 0);
	});
});
