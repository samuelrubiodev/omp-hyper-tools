import { fetchCredits, formatUsd } from "../src/credits.js";
import { renderDashboardBox, renderRequestsMessage, renderStatsMessage } from "../src/dashboard.js";
import { USD_PER_HYPERCREDIT } from "../src/hyper.js";
import { fetchHyperModels, getCachedRawModel } from "../src/models.js";
import { createTracker } from "../src/tracking.js";

async function runLiveVerification() {
	const apiKey = process.env.HYPER_API_KEY;
	if (!apiKey) {
		console.log("HYPER_API_KEY is not set. Skipping live verification.");
		return;
	}

	console.log("=== Charm Hyper Live API & Rate Limit Verification ===\n");

	// 1. Verify credits endpoint
	console.log("1. Testing GET /v1/credits...");
	const ctrl1 = new AbortController();
	const balance = await fetchCredits(apiKey, ctrl1.signal);
	console.log(`✓ Real balance fetched: ${balance} HC (${formatUsd((balance ?? 0) * USD_PER_HYPERCREDIT)})\n`);

	// 2. Verify model discovery and pricing
	console.log("2. Testing GET /v1/provider...");
	const ctrl2 = new AbortController();
	const models = await fetchHyperModels({ signal: ctrl2.signal, token: apiKey });
	console.log(`✓ Fetched ${models.length} models successfully.`);

	const firstModel = models[0];
	console.log(`  Sample Model: ${firstModel.name} (${firstModel.id})`);
	console.log(`  Input:  $${firstModel.cost.input}/1M`);
	console.log(`  Output: $${firstModel.cost.output}/1M`);
	console.log(`  Cache Read: $${firstModel.cost.cacheRead}/1M`);
	console.log(`  Context Window: ${firstModel.contextWindow}`);
	console.log(`  Reasoning: ${firstModel.reasoning}\n`);

	// 3. Perform live inference request and inspect headers & cost
	console.log("3. Performing live inference request (POST /v1/chat/completions)...");
	const response = await fetch("https://hyper.charm.land/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: firstModel.id,
			messages: [{ role: "user", content: "Say hello in 2 words" }],
		}),
	});

	const headerObj: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headerObj[key] = value;
	});

	console.log("✓ Response headers received:");
	console.log(`  x-ratelimit-limit-hour:     ${headerObj["x-ratelimit-limit-hour"] ?? "none"}`);
	console.log(`  x-ratelimit-remaining-hour: ${headerObj["x-ratelimit-remaining-hour"] ?? "none"}`);
	console.log(`  x-ratelimit-limit-day:      ${headerObj["x-ratelimit-limit-day"] ?? "none"}`);
	console.log(`  x-ratelimit-remaining-day:  ${headerObj["x-ratelimit-remaining-day"] ?? "none"}\n`);

	interface ChatResponseUsage {
		prompt_tokens?: number;
		completion_tokens?: number;
		completion_tokens_details?: { reasoning_tokens?: number };
		cost?: { usd?: number; hypercredits?: number };
	}
	const json = (await response.json()) as { usage?: ChatResponseUsage };
	const usage = json.usage;
	console.log("✓ Response usage & server accounting:");
	console.log(`  Prompt tokens:     ${usage?.prompt_tokens}`);
	console.log(`  Completion tokens: ${usage?.completion_tokens}`);
	console.log(`  Reasoning tokens:  ${usage?.completion_tokens_details?.reasoning_tokens}`);
	console.log(`  Server Cost USD:   $${usage?.cost?.usd}`);
	console.log(`  Server Cost HC:    ${usage?.cost?.hypercredits} HC\n`);

	// 4. Test tracking and rate limit integration
	console.log("4. Updating Tracker with server rate limits and request data...");
	const tracker = createTracker({ inMemory: true });
	tracker.updateServerRateLimits(headerObj);

	tracker.recordRequest({
		model: firstModel.id,
		usage: {
			inputTokens: usage?.prompt_tokens ?? 10,
			cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
			outputTokens: usage?.completion_tokens ?? 20,
			reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
			actualCostUsd: usage?.cost?.usd,
			actualCostHc: usage?.cost?.hypercredits,
		},
	});

	const summary = tracker.getSummary();

	// 5. Render requests breakdown
	console.log("5. Formatted /hyper requests output:");
	console.log(renderRequestsMessage(summary));
	console.log("\n6. Formatted /hyper stats output:");
	console.log(renderStatsMessage(summary));

	// 7. Render live dashboard box
	console.log("\n7. Rendering live dashboard box:");
	const rawModel = getCachedRawModel(firstModel.id);
	const box = renderDashboardBox({
		balance,
		lastRefreshedAt: new Date(),
		error: undefined,
		tracking: summary,
		activeModel: firstModel,
		rawModel,
	});
	console.log(box);
	console.log("\n✓ Live verification completed successfully.");
}

runLiveVerification().catch((err) => {
	console.error("Live verification failed:", err);
	process.exit(1);
});
