import type { Model, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { fetchJson } from "./http.js";
import { HYPER_API_BASE_URL, HYPER_USER_AGENT, hyperJsonHeaders, PROVIDER_NAME } from "./hyper.js";
import { parseSchema } from "./schema.js";

const MODEL_FETCH_TIMEOUT_MS = 5_000;

const PI_THINKING_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ThinkingLevel[];

// Hyper models without reasoning levels are on/off-only. Use max level as
// the single representative "on" state; deepseek compat translates off as disabled
// and any other level as enabled.
const ON_OFF_THINKING_LEVEL_MAP: ThinkingLevelMap = {
	off: "off",
	minimal: null,
	low: null,
	medium: null,
	high: null,
	xhigh: null,
	max: "max",
};

export type ReasoningEffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const VALID_EFFORTS = new Set<ReasoningEffortLevel>(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function normalizeEffortLevels(levels?: string[]): ReasoningEffortLevel[] {
	if (!levels || levels.length === 0) return [];
	const normalized: ReasoningEffortLevel[] = [];
	for (const level of levels) {
		const lower = level.toLowerCase();
		if (lower === "none" || lower === "off") {
			// OMP manages 'off'/'none' natively in the UI; non-canonical efforts crash OMP's metadata lookup
			continue;
		}
		if (VALID_EFFORTS.has(lower as ReasoningEffortLevel)) {
			if (!normalized.includes(lower as ReasoningEffortLevel)) {
				normalized.push(lower as ReasoningEffortLevel);
			}
		}
	}
	return normalized;
}

export interface ProviderModelConfig {
	id: string;
	name: string;
	api?: "openai-completions";
	reasoning: boolean;
	thinking?: {
		mode: "effort" | "deepseek" | "anthropic-adaptive";
		efforts?: ReasoningEffortLevel[];
		requiresEffort?: boolean;
	};
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
	compat?: {
		supportsStore?: boolean;
		supportsReasoningEffort?: boolean;
		thinkingFormat?: "deepseek" | "openai" | "anthropic";
		reasoningContentField?: "reasoning_content" | "reasoning" | "reasoning_text";
		maxTokensField?: "max_tokens" | "max_completion_tokens";
	};
}

export interface ProviderModel {
	id: string;
	name: string;
	cost_per_1m_in: number;
	cost_per_1m_out: number;
	cost_per_1m_in_cached: number;
	cost_per_1m_out_cached?: number;
	context_window: number;
	default_max_tokens: number;
	can_reason: boolean;
	reasoning_levels?: string[];
	default_reasoning_effort?: string;
	supports_attachments: boolean;
}

const ProviderModelSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1 }),
		cost_per_1m_in: Type.Number({ minimum: 0 }),
		cost_per_1m_out: Type.Number({ minimum: 0 }),
		cost_per_1m_in_cached: Type.Number({ minimum: 0 }),
		cost_per_1m_out_cached: Type.Optional(Type.Number({ minimum: 0 })),
		context_window: Type.Integer({ minimum: 1 }),
		default_max_tokens: Type.Integer({ minimum: 1 }),
		can_reason: Type.Boolean(),
		reasoning_levels: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
		default_reasoning_effort: Type.Optional(Type.String({ minLength: 1 })),
		supports_attachments: Type.Boolean(),
	},
	{ additionalProperties: true },
);

const ProviderPayloadSchema = Type.Object(
	{
		models: Type.Array(ProviderModelSchema, { minItems: 1 }),
	},
	{ additionalProperties: true },
);
const ProviderPayloadValidator = Compile(ProviderPayloadSchema);

const V1ModelItemSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		display_name: Type.Optional(Type.String({ minLength: 1 })),
		name: Type.Optional(Type.String({ minLength: 1 })),
		context_window: Type.Optional(Type.Integer({ minimum: 1 })),
		max_output_tokens: Type.Optional(Type.Integer({ minimum: 1 })),
		default_max_tokens: Type.Optional(Type.Integer({ minimum: 1 })),
		capabilities: Type.Optional(
			Type.Object(
				{
					vision: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: true },
			),
		),
		supports_attachments: Type.Optional(Type.Boolean()),
		reasoning: Type.Optional(
			Type.Union([
				Type.Boolean(),
				Type.Object(
					{
						effort_levels: Type.Optional(
							Type.Array(
								Type.Union([
									Type.String({ minLength: 1 }),
									Type.Object(
										{
											value: Type.String({ minLength: 1 }),
											display: Type.Optional(Type.String()),
										},
										{ additionalProperties: true },
									),
								]),
							),
						),
						default_effort_level: Type.Optional(Type.String({ minLength: 1 })),
					},
					{ additionalProperties: true },
				),
			]),
		),
		reasoning_levels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		default_reasoning_effort: Type.Optional(Type.String({ minLength: 1 })),
		can_reason: Type.Optional(Type.Boolean()),
		pricing: Type.Optional(
			Type.Object(
				{
					input: Type.Number({ minimum: 0 }),
					output: Type.Number({ minimum: 0 }),
					cache_create: Type.Optional(Type.Number({ minimum: 0 })),
					cache_hit: Type.Optional(Type.Number({ minimum: 0 })),
				},
				{ additionalProperties: true },
			),
		),
		cost_per_1m_in: Type.Optional(Type.Number({ minimum: 0 })),
		cost_per_1m_out: Type.Optional(Type.Number({ minimum: 0 })),
		cost_per_1m_in_cached: Type.Optional(Type.Number({ minimum: 0 })),
		cost_per_1m_out_cached: Type.Optional(Type.Number({ minimum: 0 })),
	},
	{ additionalProperties: true },
);

const V1ModelsResponseSchema = Type.Object(
	{
		data: Type.Array(V1ModelItemSchema, { minItems: 1 }),
	},
	{ additionalProperties: true },
);
const V1ModelsResponseValidator = Compile(V1ModelsResponseSchema);

export const DEFAULT_HYPER_MODELS: ProviderModel[] = [
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		cost_per_1m_in: 0.2,
		cost_per_1m_out: 0.4,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.04,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["high", "xhigh"],
		default_reasoning_effort: "high",
		supports_attachments: false,
	},
	{
		id: "deepseek-v4-flash-0731",
		name: "DeepSeek V4 Flash 0731",
		cost_per_1m_in: 0.44,
		cost_per_1m_out: 1.32,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.044,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["low", "high", "max"],
		default_reasoning_effort: "high",
		supports_attachments: false,
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		cost_per_1m_in: 2.4,
		cost_per_1m_out: 4.8,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.2,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["high", "xhigh"],
		default_reasoning_effort: "high",
		supports_attachments: false,
	},
	{
		id: "deepseek-v4-pro-0813",
		name: "DeepSeek V4 Pro 0813",
		cost_per_1m_in: 1.437216,
		cost_per_1m_out: 4.311648,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.0479072,
		context_window: 1048576,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["low", "high", "max"],
		default_reasoning_effort: "high",
		supports_attachments: false,
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		cost_per_1m_in: 1.52432,
		cost_per_1m_out: 4.79072,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.152432,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["high", "xhigh"],
		default_reasoning_effort: "high",
		supports_attachments: false,
	},
	{
		id: "glm-5.3",
		name: "GLM 5.3",
		cost_per_1m_in: 1.52432,
		cost_per_1m_out: 4.79072,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.283088,
		context_window: 1048576,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["low", "high", "max"],
		default_reasoning_effort: "high",
		supports_attachments: false,
	},
	{
		id: "glm-5.3-flash",
		name: "GLM 5.3 Flash",
		cost_per_1m_in: 0.16332,
		cost_per_1m_out: 0.5444,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.0315752,
		context_window: 1048576,
		default_max_tokens: 131072,
		can_reason: true,
		reasoning_levels: ["low", "high", "max"],
		default_reasoning_effort: "high",
		supports_attachments: true,
	},
	{
		id: "gpt-oss-120b",
		name: "gpt-oss-120b",
		cost_per_1m_in: 0.19,
		cost_per_1m_out: 0.63,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0,
		context_window: 128072,
		default_max_tokens: 128072,
		can_reason: true,
		reasoning_levels: ["minimal", "low", "medium", "high", "xhigh", "max"],
		default_reasoning_effort: "medium",
		supports_attachments: false,
	},
	{
		id: "kimi-k2.6",
		name: "Kimi K2.6",
		cost_per_1m_in: 1.03436,
		cost_per_1m_out: 4.3552,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.174208,
		context_window: 262000,
		default_max_tokens: 262000,
		can_reason: true,
		reasoning_levels: ["low", "medium", "high"],
		default_reasoning_effort: "high",
		supports_attachments: true,
	},
	{
		id: "kimi-k2.7-code",
		name: "Kimi K2.7 Code",
		cost_per_1m_in: 1.03436,
		cost_per_1m_out: 4.3552,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.206872,
		context_window: 262000,
		default_max_tokens: 262000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "kimi-k3",
		name: "Kimi K3",
		cost_per_1m_in: 3.2664,
		cost_per_1m_out: 16.332,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.32664,
		context_window: 1048576,
		default_max_tokens: 384000,
		can_reason: true,
		reasoning_levels: ["low", "high", "max"],
		default_reasoning_effort: "high",
		supports_attachments: true,
	},
	{
		id: "minimax-m3",
		name: "MiniMax M3",
		cost_per_1m_in: 0.32664,
		cost_per_1m_out: 1.30656,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.0642392,
		context_window: 512000,
		default_max_tokens: 512000,
		can_reason: true,
		reasoning_levels: ["low", "medium", "high"],
		default_reasoning_effort: "high",
		supports_attachments: true,
	},
	{
		id: "qwen3.6-flash",
		name: "Qwen3.6-Flash",
		cost_per_1m_in: 1.0,
		cost_per_1m_out: 4.0,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.1,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "qwen3.6-plus",
		name: "Qwen3.6-Plus",
		cost_per_1m_in: 2.0,
		cost_per_1m_out: 6.0,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.2,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "qwen3.7-flash",
		name: "Qwen3.7-Flash",
		cost_per_1m_in: 0.2,
		cost_per_1m_out: 0.8,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.04,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "qwen3.7-max",
		name: "Qwen3.7-Max",
		cost_per_1m_in: 2.5,
		cost_per_1m_out: 7.5,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.5,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: false,
	},
	{
		id: "qwen3.7-plus",
		name: "Qwen3.7-Plus",
		cost_per_1m_in: 1.2,
		cost_per_1m_out: 4.8,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.24,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "qwen3.8-27b",
		name: "Qwen3.8-27B",
		cost_per_1m_in: 0.5,
		cost_per_1m_out: 3.0,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.1,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "qwen3.8-flash",
		name: "Qwen3.8-Flash",
		cost_per_1m_in: 0.15,
		cost_per_1m_out: 0.47,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.016,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
	{
		id: "qwen3.8-max",
		name: "Qwen3.8-Max",
		cost_per_1m_in: 2.0,
		cost_per_1m_out: 6.0,
		cost_per_1m_in_cached: 0,
		cost_per_1m_out_cached: 0.25,
		context_window: 1000000,
		default_max_tokens: 384000,
		can_reason: true,
		supports_attachments: true,
	},
];

export function parseProviderPayload(payload: unknown): ProviderModel[] {
	if (typeof payload === "object" && payload !== null && "data" in payload && Array.isArray((payload as any).data)) {
		return parseV1ModelsPayload(payload);
	}
	const provider = parseSchema(ProviderPayloadValidator, payload, "Hyper /provider response");
	return provider.models;
}

export function parseV1ModelsPayload(payload: unknown): ProviderModel[] {
	const parsed = parseSchema(V1ModelsResponseValidator, payload, "Hyper /v1/models response");
	return parsed.data.map((item) => {
		const name = item.display_name ?? item.name ?? item.id;
		const vision = item.capabilities?.vision === true || item.supports_attachments === true;
		const rawEfforts: string[] = Array.isArray(item.reasoning_levels)
			? item.reasoning_levels
			: Array.isArray((item.reasoning as any)?.effort_levels)
				? (item.reasoning as any).effort_levels.map((e: any) => (typeof e === "string" ? e : e.value))
				: [];

		const reasoningEfforts = normalizeEffortLevels(rawEfforts);

		const canReason =
			typeof item.reasoning === "boolean"
				? item.reasoning
				: (item.can_reason ?? (rawEfforts.length > 0 || reasoningEfforts.length > 0));

		const defaultReasoningEffort =
			item.default_reasoning_effort ??
			(typeof item.reasoning === "object" && item.reasoning !== null
				? (item.reasoning as any).default_effort_level
				: undefined);

		return {
			id: item.id,
			name,
			cost_per_1m_in: item.pricing?.input ?? item.cost_per_1m_in ?? 0,
			cost_per_1m_out: item.pricing?.output ?? item.cost_per_1m_out ?? 0,
			cost_per_1m_in_cached: item.pricing?.cache_create ?? item.cost_per_1m_in_cached ?? 0,
			cost_per_1m_out_cached: item.pricing?.cache_hit ?? item.cost_per_1m_out_cached ?? 0,
			context_window: item.context_window ?? 1_000_000,
			default_max_tokens: item.max_output_tokens ?? item.default_max_tokens ?? 384_000,
			can_reason: canReason,
			reasoning_levels: reasoningEfforts.length > 0 ? reasoningEfforts : undefined,
			default_reasoning_effort: defaultReasoningEffort,
			supports_attachments: vision,
		};
	});
}

export function toProviderModel(model: ProviderModel): Model<"openai-completions"> {
	const input: ("text" | "image")[] = model.supports_attachments ? ["text", "image"] : ["text"];
	const reasoningLevels = normalizeEffortLevels(model.reasoning_levels);
	const supportsReasoningEffort = reasoningLevels.length > 0;
	const thinkingLevelMap = supportsReasoningEffort
		? buildThinkingLevelMap(model.reasoning_levels ?? [])
		: model.can_reason
			? ON_OFF_THINKING_LEVEL_MAP
			: undefined;

	return {
		id: model.id,
		name: model.name,
		api: "openai-completions",
		provider: PROVIDER_NAME,
		baseUrl: HYPER_API_BASE_URL,
		headers: { "User-Agent": HYPER_USER_AGENT },
		reasoning: model.can_reason,
		thinkingLevelMap,
		input,
		cost: {
			input: model.cost_per_1m_in,
			output: model.cost_per_1m_out,
			cacheRead: model.cost_per_1m_out_cached ?? 0,
			cacheWrite: model.cost_per_1m_in_cached,
		},
		contextWindow: model.context_window,
		maxTokens: model.default_max_tokens,
		compat: {
			supportsStore: false,
			supportsReasoningEffort,
			thinkingFormat: "deepseek",
			maxTokensField: "max_tokens",
		},
	};
}

export function toProviderModelConfig(model: ProviderModel): ProviderModelConfig {
	const input: ("text" | "image")[] = model.supports_attachments ? ["text", "image"] : ["text"];
	const validEfforts = normalizeEffortLevels(model.reasoning_levels);
	const supportsReasoningEffort = validEfforts.length > 0;

	return {
		id: model.id,
		name: model.name,
		api: "openai-completions",
		reasoning: model.can_reason,
		thinking: supportsReasoningEffort
			? {
					mode: "effort",
					efforts: validEfforts,
					requiresEffort: false,
				}
			: model.can_reason
				? { mode: "deepseek" }
				: undefined,
		input,
		cost: {
			input: model.cost_per_1m_in,
			output: model.cost_per_1m_out,
			cacheRead: model.cost_per_1m_out_cached ?? 0,
			cacheWrite: model.cost_per_1m_in_cached,
		},
		contextWindow: model.context_window,
		maxTokens: model.default_max_tokens,
		headers: { "User-Agent": HYPER_USER_AGENT },
		compat: {
			supportsStore: false,
			supportsReasoningEffort,
			thinkingFormat: "deepseek",
			reasoningContentField: "reasoning_content",
			maxTokensField: "max_tokens",
		},
	};
}

export function buildThinkingLevelMap(levels: string[]): ThinkingLevelMap | undefined {
	if (levels.length === 0) return undefined;
	const validEfforts = normalizeEffortLevels(levels);
	const availableLevels = new Set<string>(validEfforts);
	const disabledReasoningLevel = levels.find((level) => level === "off" || level === "none") ?? null;
	const result: ThinkingLevelMap = {
		off: disabledReasoningLevel,
	};
	for (const level of PI_THINKING_LEVELS) {
		result[level] = availableLevels.has(level) ? level : null;
	}
	return result;
}

const cachedModelsMap = new Map<string, Model<"openai-completions">>();
const cachedRawModelsMap = new Map<string, ProviderModel>();

// Seed cache with default models
updateCachedHyperModels(DEFAULT_HYPER_MODELS);

export function getCachedHyperModels(): Model<"openai-completions">[] {
	return Array.from(cachedModelsMap.values());
}

export function getCachedHyperModel(modelId: string): Model<"openai-completions"> | undefined {
	const normalized = modelId.startsWith("hyper/") ? modelId.slice(6) : modelId;
	return cachedModelsMap.get(normalized) ?? cachedModelsMap.get(modelId);
}

export function getCachedRawModel(modelId: string): ProviderModel | undefined {
	const normalized = modelId.startsWith("hyper/") ? modelId.slice(6) : modelId;
	return cachedRawModelsMap.get(normalized) ?? cachedRawModelsMap.get(modelId);
}

export function updateCachedHyperModels(models: ProviderModel[]): Model<"openai-completions">[] {
	cachedModelsMap.clear();
	cachedRawModelsMap.clear();
	const mapped = models.map((raw) => {
		const m = toProviderModel(raw);
		cachedModelsMap.set(m.id, m);
		cachedRawModelsMap.set(raw.id, raw);
		return m;
	});
	return mapped;
}

export function getDefaultProviderModelConfigs(): ProviderModelConfig[] {
	return DEFAULT_HYPER_MODELS.map(toProviderModelConfig);
}

export async function fetchHyperModels({
	signal,
	token,
}: {
	signal: AbortSignal;
	token: string | undefined;
}): Promise<Model<"openai-completions">[]> {
	try {
		const payload = await fetchJson(`${HYPER_API_BASE_URL}/models`, {
			headers: token ? hyperJsonHeaders({ Authorization: `Bearer ${token}` }) : undefined,
			signal,
			timeoutMs: MODEL_FETCH_TIMEOUT_MS,
		});
		const rawModels = parseProviderPayload(payload);
		return updateCachedHyperModels(rawModels);
	} catch {
		// Fallback to /provider endpoint if /models fails
		const payload = await fetchJson(`${HYPER_API_BASE_URL}/provider`, {
			headers: token ? hyperJsonHeaders({ Authorization: `Bearer ${token}` }) : undefined,
			signal,
			timeoutMs: MODEL_FETCH_TIMEOUT_MS,
		});
		const rawModels = parseProviderPayload(payload);
		return updateCachedHyperModels(rawModels);
	}
}
