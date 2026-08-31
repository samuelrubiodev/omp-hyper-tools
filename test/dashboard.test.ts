import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	renderCreditsMessage,
	renderDashboardBox,
	renderHelpMessage,
	renderRequestsMessage,
	renderStatsMessage,
} from "../src/dashboard.js";
import type { TrackingSummary } from "../src/tracking.js";

describe("Dashboard Output and Formatting", () => {
	const sampleTracking: TrackingSummary = {
		serverLimits: {
			limitHour: 1000,
			remainingHour: 873,
			limitDay: 10000,
			remainingDay: 8158,
			lastUpdatedAt: Date.now() - 5000,
		},
		localHourlyRequests: 127,
		localDailyRequests: 1842,
		session: {
			requests: 12,
			inputTokens: 8509,
			cachedTokens: 174912,
			cacheWriteTokens: 0,
			outputTokens: 4200,
			reasoningTokens: 1800,
			totalTokens: 187621,
			costUsd: 0.142,
			costHc: 2.84,
			actualCostUsd: 0.1415,
			actualCostHc: 2.83,
			cacheHitRate: 0.9536,
		},
		today: {
			requests: 45,
			inputTokens: 30000,
			cachedTokens: 500000,
			outputTokens: 15000,
			reasoningTokens: 6000,
			totalTokens: 545000,
			costUsd: 0.45,
			costHc: 9.0,
			actualCostUsd: 0.449,
			actualCostHc: 8.98,
			cacheHitRate: 0.943,
		},
	};

	it("renders main dashboard box with server rate limits and model info", () => {
		const box = renderDashboardBox({
			balance: 183.42,
			lastRefreshedAt: new Date(),
			error: undefined,
			tracking: sampleTracking,
			activeModel: {
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash 0731",
				provider: "hyper",
				api: "openai-completions",
				baseUrl: "https://hyper.charm.land/v1",
				reasoning: true,
				input: ["text"],
				cost: {
					input: 0.44,
					output: 1.32,
					cacheRead: 0.044,
					cacheWrite: 0,
				},
				contextWindow: 1000000,
				maxTokens: 384000,
			},
			rawModel: undefined,
		});

		assert.ok(box.includes("Hypercredits"));
		assert.ok(box.includes("183.42 HC"));
		assert.ok(box.includes("($9.17)"));
		assert.ok(box.includes("Rate Limits"));
		assert.ok(box.includes("Hour: 873 / 1000 remaining"));
		assert.ok(box.includes("Day:  8158 / 10000 remaining"));
		assert.ok(box.includes("DeepSeek V4 Flash 0731"));
		assert.ok(box.includes("Input:       $0.44 / 1M"));
		assert.ok(
			box.includes("Cache read:  $0.0440 / 1M") || box.includes("Cache read:  $0.04 / 1M") || box.includes("0.044"),
		);
		assert.ok(box.includes("Output:      $1.32 / 1M"));
		assert.ok(box.includes("Session hit rate: 95.4%"));
		assert.ok(box.includes("Session:  2.84 HC"));
	});

	it("renders graceful fallback when rate limits are unknown", () => {
		const unknownTracking: TrackingSummary = {
			serverLimits: {},
			localHourlyRequests: 0,
			localDailyRequests: 0,
			session: {
				requests: 0,
				inputTokens: 0,
				cachedTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				reasoningTokens: 0,
				totalTokens: 0,
				costUsd: 0,
				costHc: 0,
				cacheHitRate: 0,
			},
			today: {
				requests: 0,
				inputTokens: 0,
				cachedTokens: 0,
				outputTokens: 0,
				reasoningTokens: 0,
				totalTokens: 0,
				costUsd: 0,
				costHc: 0,
				cacheHitRate: 0,
			},
		};

		const box = renderDashboardBox({
			balance: undefined,
			lastRefreshedAt: undefined,
			error: "Network offline",
			tracking: unknownTracking,
			activeModel: undefined,
			rawModel: undefined,
		});

		assert.ok(box.includes("unavailable"));
		assert.ok(box.includes("Hour: Unknown"));
		assert.ok(box.includes("Day:  Unknown"));
		assert.ok(box.includes("No Hyper model selected"));
	});

	it("renders /hyper credits message", () => {
		const msg = renderCreditsMessage(183.42, new Date());
		assert.ok(msg.includes("183.42 HC"));
		assert.ok(msg.includes("$9.17"));
		assert.ok(msg.includes("authoritative server-side balance"));
	});

	it("renders /hyper requests message separating server limits from local activity", () => {
		const msg = renderRequestsMessage(sampleTracking);
		assert.ok(msg.includes("Server reported limits"));
		assert.ok(msg.includes("873 remaining / 1000"));
		assert.ok(msg.includes("8158 remaining / 10000"));
		assert.ok(msg.includes("Local activity"));
		assert.ok(msg.includes("Hour: 127 requests"));
		assert.ok(msg.includes("Day:  1842 requests"));
		assert.ok(msg.includes("Server limits are authoritative"));
	});

	it("renders /hyper stats message with estimated and server reported costs", () => {
		const msg = renderStatsMessage(sampleTracking);
		assert.ok(msg.includes("Session Usage"));
		assert.ok(msg.includes("Inference Requests:    12"));
		assert.ok(msg.includes("Uncached Input Tokens: 8,509"));
		assert.ok(msg.includes("Cached Input Tokens:   174,912"));
		assert.ok(msg.includes("Total Input Tokens:    183,421"));
		assert.ok(msg.includes("Cache Hit Rate:        95.4%"));
		assert.ok(msg.includes("Estimated Cost:        $0.14 (2.8400 HC)"));
		assert.ok(msg.includes("Server Reported Cost:  $0.14 (2.8300 HC)"));
		assert.ok(msg.includes("Today's Aggregate Usage"));
	});

	it("renders /hyper help message", () => {
		const msg = renderHelpMessage();
		assert.ok(msg.includes("/hyper credits"));
		assert.ok(msg.includes("/hyper requests"));
		assert.ok(msg.includes("/hyper stats"));
		assert.ok(msg.includes("/hyper refresh"));
		assert.ok(msg.includes("/hyper status"));
	});
});
