import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildThinkingLevelMap, parseProviderPayload, toProviderModel } from "../src/models.js";

describe("Model Parsing and Pricing", () => {
	const sampleProviderPayload = {
		name: "Charm Hyper",
		id: "hyper",
		api_endpoint: "https://hyper.charm.land/api/v1/fantasy",
		type: "hyper",
		default_large_model_id: "qwen3.8-max",
		default_small_model_id: "deepseek-v4-flash-0731",
		models: [
			{
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				cost_per_1m_in: 0.2,
				cost_per_1m_out: 0.4,
				cost_per_1m_in_cached: 0.05,
				cost_per_1m_out_cached: 0.04,
				context_window: 1000000,
				default_max_tokens: 384000,
				can_reason: true,
				reasoning_levels: ["low", "high", "xhigh"],
				default_reasoning_effort: "high",
				supports_attachments: true,
			},
			{
				id: "minimax-m2.7",
				name: "MiniMax M2.7",
				cost_per_1m_in: 0.424,
				cost_per_1m_out: 1.612,
				cost_per_1m_in_cached: 0.212,
				cost_per_1m_out_cached: 0,
				context_window: 262100,
				default_max_tokens: 6553,
				can_reason: false,
				supports_attachments: false,
			},
		],
	};

	it("parses valid provider payload into raw models", () => {
		const models = parseProviderPayload(sampleProviderPayload);
		assert.equal(models.length, 2);
		assert.equal(models[0].id, "deepseek-v4-flash");
		assert.equal(models[0].name, "DeepSeek V4 Flash");
		assert.equal(models[0].cost_per_1m_in, 0.2);
		assert.equal(models[0].cost_per_1m_out, 0.4);
		assert.equal(models[0].cost_per_1m_in_cached, 0.05);
		assert.equal(models[0].cost_per_1m_out_cached, 0.04);
		assert.equal(models[0].context_window, 1000000);
		assert.equal(models[0].default_max_tokens, 384000);
		assert.equal(models[0].can_reason, true);
		assert.equal(models[0].supports_attachments, true);
	});

	it("converts ProviderModel to pi-ai Model with correct cost structure", () => {
		const raw = sampleProviderPayload.models[0];
		const model = toProviderModel(raw);

		assert.equal(model.id, "deepseek-v4-flash");
		assert.equal(model.name, "DeepSeek V4 Flash");
		assert.equal(model.provider, "hyper");
		assert.equal(model.api, "openai-completions");
		assert.equal(model.contextWindow, 1000000);
		assert.equal(model.maxTokens, 384000);
		assert.equal(model.reasoning, true);
		assert.deepEqual(model.input, ["text", "image"]);

		assert.equal(model.cost.input, 0.2);
		assert.equal(model.cost.output, 0.4);
		assert.equal(model.cost.cacheRead, 0.04);
		assert.equal(model.cost.cacheWrite, 0.05);
	});

	it("builds thinking level map properly", () => {
		const map = buildThinkingLevelMap(["low", "high", "xhigh"]);
		assert.ok(map);
		assert.equal(map.low, "low");
		assert.equal(map.high, "high");
		assert.equal(map.xhigh, "xhigh");
		assert.equal(map.medium, null);
		assert.equal(map.minimal, null);
		assert.equal(map.max, null);
	});

	it("handles non-reasoning models correctly", () => {
		const raw = sampleProviderPayload.models[1];
		const model = toProviderModel(raw);

		assert.equal(model.reasoning, false);
		assert.equal(model.thinkingLevelMap, undefined);
		assert.deepEqual(model.input, ["text"]);
		assert.equal(model.cost.cacheRead, 0);
		assert.equal(model.cost.cacheWrite, 0.212);
	});
});
