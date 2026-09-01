import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { HYPERCREDITS_PER_USD, hyperProviderDir } from "./hyper.js";
import { getCachedHyperModel, getCachedRawModel } from "./models.js";
import type { WarningSink } from "./notify.js";
import { parseSchema } from "./schema.js";

export interface RequestUsageData {
	inputTokens: number;
	cachedTokens: number;
	cacheWriteTokens?: number;
	outputTokens: number;
	reasoningTokens?: number;
	costUsd?: number;
	costHc?: number;
	actualCostUsd?: number;
	actualCostHc?: number;
}

export interface InferenceRecord {
	sessionId?: string;
	timestamp: number;
	model: string;
	inputTokens: number;
	cachedTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	costUsd: number;
	costHc: number;
	actualCostUsd?: number;
	actualCostHc?: number;
}

export interface ServerRateLimits {
	limitHour?: number;
	remainingHour?: number;
	limitDay?: number;
	remainingDay?: number;
	lastUpdatedAt?: number;
}

export interface UsageStore {
	version: number;
	serverLimits?: ServerRateLimits;
	records: InferenceRecord[];
}

export interface ModelPricingRates {
	input: number; // $ per 1M tokens
	output: number; // $ per 1M tokens
	cacheRead: number; // $ per 1M tokens
	cacheWrite?: number; // $ per 1M tokens
}

export interface CostCalculationResult {
	costUsd: number;
	costHc: number;
	inputCostUsd: number;
	outputCostUsd: number;
	cacheReadCostUsd: number;
	cacheWriteCostUsd: number;
}

export interface SessionUsageStats {
	requests: number;
	inputTokens: number;
	cachedTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	totalTokens: number;
	costUsd: number;
	costHc: number;
	actualCostUsd?: number;
	actualCostHc?: number;
	cacheHitRate: number; // 0 to 1
}

export interface TrackingSummary {
	serverLimits: ServerRateLimits;
	localHourlyRequests: number;
	localDailyRequests: number;
	session: SessionUsageStats;
	today: {
		requests: number;
		inputTokens: number;
		cachedTokens: number;
		outputTokens: number;
		reasoningTokens: number;
		totalTokens: number;
		costUsd: number;
		costHc: number;
		actualCostUsd?: number;
		actualCostHc?: number;
		cacheHitRate: number;
	};
}

const InferenceRecordSchema = Type.Object(
	{
		sessionId: Type.Optional(Type.String()),
		timestamp: Type.Number(),
		model: Type.String(),
		inputTokens: Type.Number(),
		cachedTokens: Type.Number(),
		cacheWriteTokens: Type.Optional(Type.Number()),
		outputTokens: Type.Number(),
		reasoningTokens: Type.Optional(Type.Number()),
		costUsd: Type.Number(),
		costHc: Type.Number(),
		actualCostUsd: Type.Optional(Type.Number()),
		actualCostHc: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

const ServerRateLimitsSchema = Type.Object(
	{
		limitHour: Type.Optional(Type.Number()),
		remainingHour: Type.Optional(Type.Number()),
		limitDay: Type.Optional(Type.Number()),
		remainingDay: Type.Optional(Type.Number()),
		lastUpdatedAt: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

const UsageStoreSchema = Type.Object(
	{
		version: Type.Integer(),
		serverLimits: Type.Optional(ServerRateLimitsSchema),
		records: Type.Array(InferenceRecordSchema),
	},
	{ additionalProperties: true },
);

const UsageStoreValidator = Compile(UsageStoreSchema);

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days retention

export function defaultUsageFilePath(): string {
	return path.join(hyperProviderDir(), "usage.json");
}

/**
 * Parses rate-limit response headers case-insensitively.
 * Extracts:
 * - x-ratelimit-limit-hour
 * - x-ratelimit-limit-day
 * - x-ratelimit-remaining-hour
 * - x-ratelimit-remaining-day
 */
export function parseRateLimitHeaders(headers: Record<string, string> | Headers | undefined): ServerRateLimits {
	if (!headers) return {};

	const getHeader = (name: string): string | null => {
		if ("get" in headers && typeof headers.get === "function") {
			return headers.get(name) ?? headers.get(name.toLowerCase());
		}
		const obj = headers as Record<string, string>;
		const target = name.toLowerCase();
		for (const [k, v] of Object.entries(obj)) {
			if (k.toLowerCase() === target) {
				return v;
			}
		}
		return null;
	};

	const parsePositiveInt = (val: string | null): number | undefined => {
		if (!val) return undefined;
		const parsed = Number.parseInt(val.trim(), 10);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
	};

	const limitHour = parsePositiveInt(getHeader("x-ratelimit-limit-hour"));
	const remainingHour = parsePositiveInt(getHeader("x-ratelimit-remaining-hour"));
	const limitDay = parsePositiveInt(getHeader("x-ratelimit-limit-day"));
	const remainingDay = parsePositiveInt(getHeader("x-ratelimit-remaining-day"));

	const result: ServerRateLimits = {};
	if (limitHour !== undefined) result.limitHour = limitHour;
	if (remainingHour !== undefined) result.remainingHour = remainingHour;
	if (limitDay !== undefined) result.limitDay = limitDay;
	if (remainingDay !== undefined) result.remainingDay = remainingDay;

	if (Object.keys(result).length > 0) {
		result.lastUpdatedAt = Date.now();
	}

	return result;
}

/**
 * Calculate cost breakdown in USD and Hypercredits based on token rates per 1M tokens.
 */
export function calculateEstimatedCost(
	rates: ModelPricingRates | undefined,
	usage: {
		inputTokens: number;
		cachedTokens: number;
		cacheWriteTokens?: number;
		outputTokens: number;
	},
): CostCalculationResult {
	if (!rates) {
		return {
			costUsd: 0,
			costHc: 0,
			inputCostUsd: 0,
			outputCostUsd: 0,
			cacheReadCostUsd: 0,
			cacheWriteCostUsd: 0,
		};
	}

	const uncachedInputTokens = usage.inputTokens;
	const cachedTokens = usage.cachedTokens;
	const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
	const outputTokens = usage.outputTokens;

	const inputRate = rates.input ?? 0;
	const outputRate = rates.output ?? 0;
	const cacheReadRate = rates.cacheRead ?? 0;
	const cacheWriteRate = rates.cacheWrite ?? inputRate; // Fall back to uncached rate if cacheWrite not specified

	const inputCostUsd = (uncachedInputTokens / 1_000_000) * inputRate;
	const outputCostUsd = (outputTokens / 1_000_000) * outputRate;
	const cacheReadCostUsd = (cachedTokens / 1_000_000) * cacheReadRate;
	const cacheWriteCostUsd = (cacheWriteTokens / 1_000_000) * cacheWriteRate;

	const totalCostUsd = inputCostUsd + outputCostUsd + cacheReadCostUsd + cacheWriteCostUsd;
	const totalCostHc = totalCostUsd * HYPERCREDITS_PER_USD;

	return {
		costUsd: totalCostUsd,
		costHc: totalCostHc,
		inputCostUsd,
		outputCostUsd,
		cacheReadCostUsd,
		cacheWriteCostUsd,
	};
}

/**
 * Calculate cache hit rate: cached / (uncached + cached).
 */
export function calculateCacheHitRate(cachedTokens: number, uncachedInputTokens: number): number {
	const total = cachedTokens + uncachedInputTokens;
	if (total <= 0) return 0;
	return cachedTokens / total;
}

/**
 * Resolve pricing rates for a given model ID.
 */
export function resolveModelPricing(modelId: string): ModelPricingRates | undefined {
	const cached = getCachedHyperModel(modelId);
	if (cached?.cost) {
		return {
			input: cached.cost.input,
			output: cached.cost.output,
			cacheRead: cached.cost.cacheRead,
			cacheWrite: cached.cost.cacheWrite,
		};
	}

	const raw = getCachedRawModel(modelId);
	if (raw) {
		return {
			input: raw.cost_per_1m_in,
			output: raw.cost_per_1m_out,
			cacheRead: raw.cost_per_1m_out_cached ?? 0,
			cacheWrite: raw.cost_per_1m_in_cached,
		};
	}

	return undefined;
}

export function readUsageStore(filePath = defaultUsageFilePath(), warn?: WarningSink): UsageStore {
	if (!existsSync(filePath)) {
		return { version: 1, records: [] };
	}

	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		const validated = parseSchema(UsageStoreValidator, parsed, "usage.json");
		const normalizedRecords: InferenceRecord[] = validated.records.map((r) => ({
			sessionId: r.sessionId,
			timestamp: r.timestamp,
			model: r.model,
			inputTokens: r.inputTokens,
			cachedTokens: r.cachedTokens,
			cacheWriteTokens: r.cacheWriteTokens ?? 0,
			outputTokens: r.outputTokens,
			reasoningTokens: r.reasoningTokens ?? 0,
			costUsd: r.costUsd,
			costHc: r.costHc,
			actualCostUsd: r.actualCostUsd,
			actualCostHc: r.actualCostHc,
		}));
		return {
			version: validated.version,
			serverLimits: validated.serverLimits,
			records: normalizedRecords,
		};
	} catch (error) {
		warn?.(`Failed to read Hyper usage history: ${String(error)}`);
		return { version: 1, records: [] };
	}
}

export function writeUsageStore(store: UsageStore, filePath = defaultUsageFilePath(), warn?: WarningSink): void {
	try {
		mkdirSync(path.dirname(filePath), { recursive: true });
		// Prune records older than 30 days
		const cutoff = Date.now() - RETENTION_MS;
		const prunedRecords = store.records.filter((r) => r.timestamp >= cutoff);
		const payload: UsageStore = {
			version: store.version,
			serverLimits: store.serverLimits,
			records: prunedRecords,
		};
		writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
	} catch (error) {
		warn?.(`Failed to save Hyper usage history: ${String(error)}`);
	}
}

/**
 * Returns the start timestamp of the local clock hour containing `date`.
 */
export function startOfLocalHour(date: Date): number {
	const d = new Date(date);
	d.setMinutes(0, 0, 0);
	return d.getTime();
}

/**
 * Returns the end timestamp of the local clock hour containing `date`.
 */
export function endOfLocalHour(date: Date): number {
	const d = new Date(date);
	d.setMinutes(59, 59, 999);
	return d.getTime();
}

/**
 * Returns the start timestamp of the local calendar day containing `date`.
 */
export function startOfLocalDay(date: Date): number {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * Returns the end timestamp of the local calendar day containing `date`.
 */
export function endOfLocalDay(date: Date): number {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d.getTime();
}

export interface TrackerOptions {
	warn?: WarningSink;
	storagePath?: string;
	inMemory?: boolean;
}

export interface Tracker {
	setActiveSession(sessionId: string | undefined): void;
	recordRequest(params: {
		model: string;
		usage?: RequestUsageData;
		timestamp?: number;
		sessionId?: string;
	}): InferenceRecord;
	updateServerRateLimits(headers: Record<string, string> | Headers | undefined): ServerRateLimits;
	getServerRateLimits(): ServerRateLimits;
	getSummary(now?: Date, sessionId?: string): TrackingSummary;
	getSessionStats(sessionId?: string): SessionUsageStats;
	resetSession(): void;
	clearHistory(): void;
}

export function createTracker(optionsOrWarn?: WarningSink | TrackerOptions): Tracker {
	const options: TrackerOptions = typeof optionsOrWarn === "function" ? { warn: optionsOrWarn } : (optionsOrWarn ?? {});

	const warn = options.warn;
	const isInMemory = options.inMemory ?? false;
	const storagePath = options.storagePath ?? defaultUsageFilePath();

	let inMemoryRecords: InferenceRecord[] = [];
	let currentServerLimits: ServerRateLimits = {};
	let activeSessionId: string | undefined;

	// Load initial server limits from disk if present
	if (!isInMemory) {
		const initialStore = readUsageStore(storagePath, warn);
		if (initialStore.serverLimits) {
			currentServerLimits = { ...initialStore.serverLimits };
		}
	}

	let ephemeralSessionStats: SessionUsageStats = {
		requests: 0,
		inputTokens: 0,
		cachedTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		costUsd: 0,
		costHc: 0,
		actualCostUsd: undefined,
		actualCostHc: undefined,
		cacheHitRate: 0,
	};

	function getStore(): UsageStore {
		if (isInMemory) {
			return {
				version: 1,
				serverLimits: currentServerLimits,
				records: inMemoryRecords,
			};
		}
		return readUsageStore(storagePath, warn);
	}

	function persistStore(store: UsageStore): void {
		if (isInMemory) {
			inMemoryRecords = store.records;
			currentServerLimits = store.serverLimits ?? {};
			return;
		}
		try {
			writeUsageStore(store, storagePath, warn);
		} catch (error) {
			warn?.(`Failed to persist inference tracking: ${String(error)}`);
		}
	}

	function setActiveSession(sessionId: string | undefined): void {
		activeSessionId = sessionId;
	}

	function updateServerRateLimits(headers: Record<string, string> | Headers | undefined): ServerRateLimits {
		const parsed = parseRateLimitHeaders(headers);
		if (Object.keys(parsed).length > 0) {
			currentServerLimits = {
				...currentServerLimits,
				...parsed,
				lastUpdatedAt: parsed.lastUpdatedAt ?? Date.now(),
			};
			const store = getStore();
			store.serverLimits = currentServerLimits;
			persistStore(store);
		}
		return { ...currentServerLimits };
	}

	function getServerRateLimits(): ServerRateLimits {
		return { ...currentServerLimits };
	}

	function recordRequest(params: {
		model: string;
		usage?: RequestUsageData;
		timestamp?: number;
		sessionId?: string;
	}): InferenceRecord {
		const now = params.timestamp ?? Date.now();
		const targetSessionId = params.sessionId ?? activeSessionId;
		const u = params.usage;
		const inputTokens = u?.inputTokens ?? 0;
		const cachedTokens = u?.cachedTokens ?? 0;
		const cacheWriteTokens = u?.cacheWriteTokens ?? 0;
		const outputTokens = u?.outputTokens ?? 0;
		const reasoningTokens = u?.reasoningTokens ?? 0;

		// Calculate estimated costs
		const pricing = resolveModelPricing(params.model);
		const calculated = calculateEstimatedCost(pricing, {
			inputTokens,
			cachedTokens,
			cacheWriteTokens,
			outputTokens,
		});

		const estimatedCostUsd = calculated.costUsd;
		const estimatedCostHc = calculated.costHc;

		// Server-reported actual cost if available
		const actualCostUsd = u?.actualCostUsd ?? u?.costUsd;
		const actualCostHc =
			u?.actualCostHc ?? (actualCostUsd !== undefined ? actualCostUsd * HYPERCREDITS_PER_USD : undefined);

		const record: InferenceRecord = {
			sessionId: targetSessionId,
			timestamp: now,
			model: params.model,
			inputTokens,
			cachedTokens,
			cacheWriteTokens,
			outputTokens,
			reasoningTokens,
			costUsd: estimatedCostUsd,
			costHc: estimatedCostHc,
			actualCostUsd,
			actualCostHc,
		};

		// Update in-memory fallback session counters
		ephemeralSessionStats.requests += 1;
		ephemeralSessionStats.inputTokens += inputTokens;
		ephemeralSessionStats.cachedTokens += cachedTokens;
		ephemeralSessionStats.cacheWriteTokens += cacheWriteTokens;
		ephemeralSessionStats.outputTokens += outputTokens;
		ephemeralSessionStats.reasoningTokens += reasoningTokens;
		ephemeralSessionStats.totalTokens += inputTokens + cachedTokens + cacheWriteTokens + outputTokens;
		ephemeralSessionStats.costUsd += estimatedCostUsd;
		ephemeralSessionStats.costHc += estimatedCostHc;

		if (actualCostUsd !== undefined) {
			ephemeralSessionStats.actualCostUsd = (ephemeralSessionStats.actualCostUsd ?? 0) + actualCostUsd;
		}
		if (actualCostHc !== undefined) {
			ephemeralSessionStats.actualCostHc = (ephemeralSessionStats.actualCostHc ?? 0) + actualCostHc;
		}

		ephemeralSessionStats.cacheHitRate = calculateCacheHitRate(
			ephemeralSessionStats.cachedTokens,
			ephemeralSessionStats.inputTokens,
		);

		// Persist record
		const store = getStore();
		store.records.push(record);
		store.serverLimits = currentServerLimits;
		persistStore(store);

		return record;
	}

	function getSessionStats(sessionId?: string): SessionUsageStats {
		const targetSessionId = sessionId ?? activeSessionId;
		if (!targetSessionId) {
			return { ...ephemeralSessionStats };
		}

		const store = getStore();
		const sessionRecords = store.records.filter((r) => r.sessionId === targetSessionId);
		if (sessionRecords.length === 0) {
			return { ...ephemeralSessionStats };
		}

		let requests = 0;
		let inputTokens = 0;
		let cachedTokens = 0;
		let cacheWriteTokens = 0;
		let outputTokens = 0;
		let reasoningTokens = 0;
		let costUsd = 0;
		let costHc = 0;
		let actualCostUsd: number | undefined;
		let actualCostHc: number | undefined;

		for (const rec of sessionRecords) {
			requests += 1;
			inputTokens += rec.inputTokens;
			cachedTokens += rec.cachedTokens;
			cacheWriteTokens += rec.cacheWriteTokens ?? 0;
			outputTokens += rec.outputTokens;
			reasoningTokens += rec.reasoningTokens ?? 0;
			costUsd += rec.costUsd;
			costHc += rec.costHc;
			if (rec.actualCostUsd !== undefined) {
				actualCostUsd = (actualCostUsd ?? 0) + rec.actualCostUsd;
			}
			if (rec.actualCostHc !== undefined) {
				actualCostHc = (actualCostHc ?? 0) + rec.actualCostHc;
			}
		}

		const totalTokens = inputTokens + cachedTokens + cacheWriteTokens + outputTokens;
		const cacheHitRate = calculateCacheHitRate(cachedTokens, inputTokens);

		return {
			requests,
			inputTokens,
			cachedTokens,
			cacheWriteTokens,
			outputTokens,
			reasoningTokens,
			totalTokens,
			costUsd,
			costHc,
			actualCostUsd,
			actualCostHc,
			cacheHitRate,
		};
	}

	function getSummary(nowDate: Date = new Date(), sessionId?: string): TrackingSummary {
		const hourStart = startOfLocalHour(nowDate);
		const hourEnd = endOfLocalHour(nowDate);
		const dayStart = startOfLocalDay(nowDate);
		const dayEnd = endOfLocalDay(nowDate);

		const store = getStore();
		const records = store.records;

		let localHourlyRequests = 0;
		let localDailyRequests = 0;

		const todayStats = {
			requests: 0,
			inputTokens: 0,
			cachedTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
			totalTokens: 0,
			costUsd: 0,
			costHc: 0,
			actualCostUsd: undefined as number | undefined,
			actualCostHc: undefined as number | undefined,
			cacheHitRate: 0,
		};

		for (const rec of records) {
			if (rec.timestamp >= dayStart && rec.timestamp <= dayEnd) {
				localDailyRequests += 1;
				todayStats.requests += 1;
				todayStats.inputTokens += rec.inputTokens;
				todayStats.cachedTokens += rec.cachedTokens;
				todayStats.outputTokens += rec.outputTokens;
				todayStats.reasoningTokens += rec.reasoningTokens;
				todayStats.totalTokens += rec.inputTokens + rec.cachedTokens + rec.cacheWriteTokens + rec.outputTokens;
				todayStats.costUsd += rec.costUsd;
				todayStats.costHc += rec.costHc;
				if (rec.actualCostUsd !== undefined) {
					todayStats.actualCostUsd = (todayStats.actualCostUsd ?? 0) + rec.actualCostUsd;
				}
				if (rec.actualCostHc !== undefined) {
					todayStats.actualCostHc = (todayStats.actualCostHc ?? 0) + rec.actualCostHc;
				}
			}
			if (rec.timestamp >= hourStart && rec.timestamp <= hourEnd) {
				localHourlyRequests += 1;
			}
		}

		todayStats.cacheHitRate = calculateCacheHitRate(todayStats.cachedTokens, todayStats.inputTokens);

		return {
			serverLimits: { ...currentServerLimits },
			localHourlyRequests,
			localDailyRequests,
			session: getSessionStats(sessionId),
			today: todayStats,
		};
	}

	function resetSession(): void {
		ephemeralSessionStats = {
			requests: 0,
			inputTokens: 0,
			cachedTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
			totalTokens: 0,
			costUsd: 0,
			costHc: 0,
			actualCostUsd: undefined,
			actualCostHc: undefined,
			cacheHitRate: 0,
		};
	}

	function clearHistory(): void {
		inMemoryRecords = [];
		currentServerLimits = {};
		resetSession();
		if (!isInMemory) {
			try {
				if (existsSync(storagePath)) {
					writeFileSync(storagePath, `${JSON.stringify({ version: 1, records: [] }, null, 2)}\n`, "utf-8");
				}
			} catch (error) {
				warn?.(`Failed to clear Hyper usage history: ${String(error)}`);
			}
		}
	}

	return {
		setActiveSession,
		recordRequest,
		updateServerRateLimits,
		getServerRateLimits,
		getSummary,
		getSessionStats,
		resetSession,
		clearHistory,
	};
}
