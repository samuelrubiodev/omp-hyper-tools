import type { Api, Model } from "@earendil-works/pi-ai";
import { formatCredits, formatUsd } from "./credits.js";
import { USD_PER_HYPERCREDIT } from "./hyper.js";
import type { ProviderModel } from "./models.js";
import type { TrackingSummary } from "./tracking.js";

export interface DashboardData {
	balance: number | undefined;
	lastRefreshedAt: Date | undefined;
	error: string | undefined;
	tracking: TrackingSummary;
	activeModel: Model<Api> | undefined;
	rawModel: ProviderModel | undefined;
}

/**
 * Format relative or ISO timestamp.
 */
function formatTime(d: Date | undefined): string {
	if (!d) return "never";
	const now = Date.now();
	const diffSec = Math.floor((now - d.getTime()) / 1000);
	if (diffSec < 5) return "just now";
	if (diffSec < 60) return `${diffSec}s ago`;
	if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
	if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
	return d.toLocaleDateString();
}

/**
 * Renders the main compact terminal dashboard box for /hyper.
 */
export function renderDashboardBox(data: DashboardData): string {
	const lines: string[] = [];

	const balanceText =
		data.balance !== undefined
			? `${formatCredits(data.balance)} HC   (${formatUsd(data.balance * USD_PER_HYPERCREDIT)})`
			: data.error
				? "unavailable (check auth/network)"
				: "loading...";

	// Model information
	const modelName = data.rawModel?.name ?? data.activeModel?.name ?? data.activeModel?.id ?? "No Hyper model selected";

	// Model pricing
	const cost = data.activeModel?.cost;
	const raw = data.rawModel;
	const inputCost = cost?.input ?? raw?.cost_per_1m_in;
	const cacheReadCost = cost?.cacheRead ?? raw?.cost_per_1m_out_cached ?? 0;
	const cacheWriteCost = cost?.cacheWrite ?? raw?.cost_per_1m_in_cached;
	const outputCost = cost?.output ?? raw?.cost_per_1m_out;

	const hitRatePercent = (data.tracking.session.cacheHitRate * 100).toFixed(1);
	const sessionCostHc = `${data.tracking.session.costHc.toFixed(2)} HC`;
	const sessionCostUsd = formatUsd(data.tracking.session.costUsd);

	const serverLimits = data.tracking.serverLimits;
	const hourText =
		serverLimits.remainingHour !== undefined && serverLimits.limitHour !== undefined
			? `${serverLimits.remainingHour} / ${serverLimits.limitHour} remaining`
			: serverLimits.limitHour !== undefined
				? `${serverLimits.limitHour} limit`
				: "Unknown";

	const dayText =
		serverLimits.remainingDay !== undefined && serverLimits.limitDay !== undefined
			? `${serverLimits.remainingDay} / ${serverLimits.limitDay} remaining`
			: serverLimits.limitDay !== undefined
				? `${serverLimits.limitDay} limit`
				: "Unknown";

	const contentLines: string[] = [
		"",
		" Hypercredits",
		`   ${balanceText}`,
		"",
		" Rate Limits",
		`   Hour: ${hourText}`,
		`   Day:  ${dayText}`,
		"",
		" Model",
		`   ${modelName}`,
	];

	if (inputCost !== undefined && outputCost !== undefined) {
		contentLines.push("", " Pricing");
		contentLines.push(`   Input:       $${inputCost.toFixed(inputCost < 0.01 ? 4 : 2)} / 1M`);
		contentLines.push(`   Cache read:  $${cacheReadCost.toFixed(cacheReadCost < 0.01 ? 4 : 2)} / 1M`);
		if (cacheWriteCost !== undefined && cacheWriteCost > 0) {
			contentLines.push(`   Cache write: $${cacheWriteCost.toFixed(cacheWriteCost < 0.01 ? 4 : 2)} / 1M`);
		}
		contentLines.push(`   Output:      $${outputCost.toFixed(outputCost < 0.01 ? 4 : 2)} / 1M`);
	}

	contentLines.push(
		"",
		" Cache",
		`   Session hit rate: ${hitRatePercent}%`,
		"",
		" Usage",
		`   Session:  ${sessionCostHc}  (${sessionCostUsd})`,
		"",
	);

	// Determine width based on longest content line
	const maxContentLen = Math.max(34, ...contentLines.map((l) => l.length));
	const boxWidth = maxContentLen + 2;

	const title = " Hyper ";
	const topBorder = `╭─${title}${"─".repeat(Math.max(0, boxWidth - 2 - title.length))}╮`;
	const bottomBorder = `╰${"─".repeat(boxWidth)}╯`;

	lines.push(topBorder);
	for (const cl of contentLines) {
		const padded = cl.padEnd(boxWidth);
		lines.push(`│${padded}│`);
	}
	lines.push(bottomBorder);

	return lines.join("\n");
}

/**
 * Render /hyper credits output.
 */
export function renderCreditsMessage(
	balance: number | undefined,
	lastRefreshedAt: Date | undefined,
	error?: string,
): string {
	if (balance === undefined) {
		const errorHint = error ? `\nError: ${error}` : "";
		return `Hypercredit Balance\n\n  Status: Unavailable${errorHint}\n  Run /hyper refresh to retry.`;
	}

	const usd = balance * USD_PER_HYPERCREDIT;
	const refreshed = formatTime(lastRefreshedAt);

	return [
		"Hypercredits (authoritative server-side balance)",
		"",
		`  Balance:         ${formatCredits(balance)} HC`,
		`  USD Equivalent:  ${formatUsd(usd)}`,
		`  Last Refreshed:  ${refreshed}`,
	].join("\n");
}

/**
 * Render /hyper requests output.
 */
export function renderRequestsMessage(summary: TrackingSummary): string {
	const limits = summary.serverLimits;

	const hourServer =
		limits.remainingHour !== undefined && limits.limitHour !== undefined
			? `${limits.remainingHour} remaining / ${limits.limitHour}`
			: limits.limitHour !== undefined
				? `${limits.limitHour} limit (remaining unknown)`
				: "Unknown (no inference responses yet)";

	const dayServer =
		limits.remainingDay !== undefined && limits.limitDay !== undefined
			? `${limits.remainingDay} remaining / ${limits.limitDay}`
			: limits.limitDay !== undefined
				? `${limits.limitDay} limit (remaining unknown)`
				: "Unknown (no inference responses yet)";

	const lastUpdate = formatTime(limits.lastUpdatedAt ? new Date(limits.lastUpdatedAt) : undefined);

	return [
		"Requests",
		"",
		"Server reported limits",
		`  Hour: ${hourServer}`,
		`  Day:  ${dayServer}`,
		`  Last server update: ${lastUpdate}`,
		"",
		"Local activity",
		`  Hour: ${summary.localHourlyRequests} request${summary.localHourlyRequests === 1 ? "" : "s"}`,
		`  Day:  ${summary.localDailyRequests} request${summary.localDailyRequests === 1 ? "" : "s"}`,
		"",
		"Note: Server limits are authoritative from Hyper response headers. Local activity counts inference requests made from this OMP session/machine.",
	].join("\n");
}

/**
 * Render /hyper stats output.
 */
export function renderStatsMessage(summary: TrackingSummary): string {
	const s = summary.session;
	const t = summary.today;

	const sHitRate = (s.cacheHitRate * 100).toFixed(1);
	const tHitRate = (t.cacheHitRate * 100).toFixed(1);

	const lines = [
		"Hyper Usage Statistics",
		"",
		"Session Usage",
		`  Inference Requests:    ${s.requests}`,
		`  Uncached Input Tokens: ${s.inputTokens.toLocaleString("en-US")}`,
		`  Cached Input Tokens:   ${s.cachedTokens.toLocaleString("en-US")}`,
		`  Total Input Tokens:    ${(s.inputTokens + s.cachedTokens).toLocaleString("en-US")}`,
		`  Cache Hit Rate:        ${sHitRate}% (cached / (uncached + cached))`,
	];

	if (s.cacheWriteTokens > 0) {
		lines.push(`  Cache Write Tokens:    ${s.cacheWriteTokens.toLocaleString("en-US")}`);
	}

	lines.push(
		`  Output Tokens:         ${s.outputTokens.toLocaleString("en-US")}`,
		`  Reasoning Tokens:      ${s.reasoningTokens.toLocaleString("en-US")}`,
		`  Total Tokens:          ${s.totalTokens.toLocaleString("en-US")}`,
		`  Estimated Cost:        ${formatUsd(s.costUsd)} (${s.costHc.toFixed(4)} HC)`,
	);

	if (s.actualCostUsd !== undefined && s.actualCostHc !== undefined) {
		lines.push(`  Server Reported Cost:  ${formatUsd(s.actualCostUsd)} (${s.actualCostHc.toFixed(4)} HC)`);
	}

	lines.push(
		"",
		"Today's Aggregate Usage",
		`  Inference Requests:    ${t.requests}`,
		`  Uncached Input Tokens: ${t.inputTokens.toLocaleString("en-US")}`,
		`  Cached Input Tokens:   ${t.cachedTokens.toLocaleString("en-US")}`,
		`  Total Input Tokens:    ${(t.inputTokens + t.cachedTokens).toLocaleString("en-US")}`,
		`  Cache Hit Rate:        ${tHitRate}% (cached / (uncached + cached))`,
		`  Output Tokens:         ${t.outputTokens.toLocaleString("en-US")}`,
		`  Reasoning Tokens:      ${t.reasoningTokens.toLocaleString("en-US")}`,
		`  Total Tokens:          ${t.totalTokens.toLocaleString("en-US")}`,
		`  Estimated Cost:        ${formatUsd(t.costUsd)} (${t.costHc.toFixed(4)} HC)`,
	);

	if (t.actualCostUsd !== undefined && t.actualCostHc !== undefined) {
		lines.push(`  Server Reported Cost:  ${formatUsd(t.actualCostUsd)} (${t.actualCostHc.toFixed(4)} HC)`);
	}

	return lines.join("\n");
}

/**
 * Render /hyper help message.
 */
export function renderHelpMessage(): string {
	return [
		"Charm Hyper Commands",
		"",
		"  /hyper            Show full Hyper dashboard",
		"  /hyper credits    Show current Hypercredit balance and USD value",
		"  /hyper requests   Show server rate limits and local request activity",
		"  /hyper stats      Show token usage, cache hit rate, and costs",
		"  /hyper refresh    Force fresh update of credits and model pricing",
		"  /hyper status     Configure footer status items",
		"  /hyper help       Show this help message",
		"",
		"  /hyper-status     (Legacy alias) Configure footer status items",
	].join("\n");
}
