import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createHyperAutocompleteProvider,
	getHyperArgumentCompletions,
	getHyperStatusArgumentCompletions,
} from "./autocomplete.js";
import { type CreditStatusRuntime, formatCredits } from "./credits.js";
import {
	renderCreditsMessage,
	renderDashboardBox,
	renderHelpMessage,
	renderRequestsMessage,
	renderStatsMessage,
} from "./dashboard.js";
import {
	HYPER_API_BASE_URL,
	HYPER_USER_AGENT,
	HYPERCREDITS_PER_USD,
	PROVIDER_DISPLAY_NAME,
	PROVIDER_NAME,
} from "./hyper.js";
import {
	fetchHyperModels,
	getCachedRawModel,
	getDefaultProviderModelConfigs,
	toProviderModelConfig,
} from "./models.js";
import { createNotifier } from "./notify.js";
import { loginHyper, refreshHyperToken } from "./oauth.js";
import { createTracker, type Tracker } from "./tracking.js";

type CreditStatusState =
	| { kind: "idle" }
	| { kind: "loading"; operation: Promise<CreditStatusRuntime> }
	| { kind: "ready"; runtime: CreditStatusRuntime }
	| { kind: "disposed" };

type PendingCreditStatusRefresh = {
	ctx: ExtensionContext;
	model: ExtensionContext["model"];
};

export default function (pi: ExtensionAPI) {
	const notifier = createNotifier();
	const tracker: Tracker = createTracker(notifier.warn);
	let creditStatusState: CreditStatusState = { kind: "idle" };
	let pendingCreditStatusRefresh: PendingCreditStatusRefresh | undefined;
	let creditStatusRefreshWork: ReturnType<typeof setImmediate> | undefined;

	function loadCreditStatus(): Promise<CreditStatusRuntime> {
		if (creditStatusState.kind === "ready") return Promise.resolve(creditStatusState.runtime);
		if (creditStatusState.kind === "loading") return creditStatusState.operation;
		if (creditStatusState.kind === "disposed") {
			return Promise.reject(new Error("Hyper status support was disposed"));
		}

		const operation = import("./credits.js").then(({ createCreditStatusRuntime }) => {
			const runtime = createCreditStatusRuntime(notifier.warn);
			if (creditStatusState.kind === "disposed") {
				runtime.dispose();
				return runtime;
			}
			creditStatusState = { kind: "ready", runtime };
			return runtime;
		});
		creditStatusState = { kind: "loading", operation };
		void operation.catch(() => {
			if (creditStatusState.kind === "loading" && creditStatusState.operation === operation) {
				creditStatusState = { kind: "idle" };
			}
		});
		return operation;
	}

	function schedulePendingCreditStatusRefresh(): void {
		if (!pendingCreditStatusRefresh || creditStatusRefreshWork !== undefined) return;

		const scheduled = setImmediate(() => {
			void loadCreditStatus()
				.then((runtime) => {
					if (creditStatusRefreshWork !== scheduled) return;
					const refresh = pendingCreditStatusRefresh;
					pendingCreditStatusRefresh = undefined;
					creditStatusRefreshWork = undefined;
					if (refresh) {
						void runtime.refresh(refresh.ctx, refresh.model).catch((error: unknown) => {
							if (creditStatusState.kind !== "disposed") {
								notifier.warn(`Unable to refresh Hyper status: ${String(error)}`);
							}
						});
					}
				})
				.catch((error: unknown) => {
					if (creditStatusRefreshWork === scheduled && creditStatusState.kind !== "disposed") {
						pendingCreditStatusRefresh = undefined;
						notifier.warn(`Unable to load Hyper status support: ${String(error)}`);
					}
				})
				.finally(() => {
					if (creditStatusRefreshWork !== scheduled) return;
					creditStatusRefreshWork = undefined;
					schedulePendingCreditStatusRefresh();
				});
		});
		creditStatusRefreshWork = scheduled;
	}

	function scheduleCreditStatusRefresh(ctx: ExtensionContext, model: ExtensionContext["model"]): void {
		pendingCreditStatusRefresh = { ctx, model };
		schedulePendingCreditStatusRefresh();
	}

	function deactivateCreditStatus(ctx: ExtensionContext, model: ExtensionContext["model"]): void {
		pendingCreditStatusRefresh = undefined;
		if (creditStatusRefreshWork !== undefined) {
			clearImmediate(creditStatusRefreshWork);
			creditStatusRefreshWork = undefined;
		}
		if (creditStatusState.kind === "ready") {
			void creditStatusState.runtime.refresh(ctx, model);
		}
		ctx.ui.setStatus(PROVIDER_NAME, undefined);
	}

	pi.on("session_start", (_event, ctx) => {
		notifier.activate(ctx);
		if (ctx.hasUI && typeof ctx.ui.addAutocompleteProvider === "function") {
			ctx.ui.addAutocompleteProvider((current) => createHyperAutocompleteProvider(current));
		}
		if (!ctx.hasUI) return;
		if (ctx.model?.provider !== PROVIDER_NAME) {
			deactivateCreditStatus(ctx, ctx.model);
			return;
		}
		scheduleCreditStatusRefresh(ctx, ctx.model);
	});

	// Register Provider with OMP
	const providerConfig = {
		baseUrl: HYPER_API_BASE_URL,
		api: "openai-completions" as const,
		authHeader: true,
		headers: {
			"User-Agent": HYPER_USER_AGENT,
		},
		models: getDefaultProviderModelConfigs(),
		oauth: {
			name: PROVIDER_DISPLAY_NAME,
			login: async (callbacks: any) => {
				return loginHyper(callbacks);
			},
			refreshToken: async (credentials: any, signal?: AbortSignal) => {
				return refreshHyperToken(credentials, signal);
			},
			getApiKey: (credentials: any) => {
				return credentials.access;
			},
		},
		fetchDynamicModels: async (apiKey: string | undefined) => {
			const ctrl = new AbortController();
			const rawModels = await fetchHyperModels({ signal: ctrl.signal, token: apiKey });
			return rawModels.map((m) => toProviderModelConfig(m as any));
		},
	};

	if (typeof (pi as any).registerProvider === "function") {
		try {
			(pi as any).registerProvider(PROVIDER_NAME, providerConfig);
		} catch {
			// Fallback for legacy registerProvider signature if needed
		}
	}

	pi.registerCommand("hyper", {
		description: "Charm Hyper dashboard, credits, requests, and stats",
		getArgumentCompletions: (argumentPrefix: string) => {
			return getHyperArgumentCompletions(argumentPrefix);
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const subcommand = tokens[0]?.toLowerCase() ?? "";

			try {
				const runtime = await loadCreditStatus();
				if (creditStatusState.kind === "disposed") return;

				if (subcommand === "credits") {
					if (runtime.getBalance() === undefined) {
						await runtime.refresh(ctx, ctx.model, true);
					}
					const msg = renderCreditsMessage(runtime.getBalance(), runtime.getLastRefreshedAt(), runtime.getLastError());
					ctx.ui.notify(msg, "info");
					return;
				}

				const sessionId = ctx.sessionManager?.getSessionId?.();
				tracker.setActiveSession(sessionId);

				if (subcommand === "requests") {
					const summary = tracker.getSummary(undefined, sessionId);
					const msg = renderRequestsMessage(summary);
					ctx.ui.notify(msg, "info");
					return;
				}

				if (subcommand === "stats") {
					const summary = tracker.getSummary(undefined, sessionId);
					const msg = renderStatsMessage(summary);
					ctx.ui.notify(msg, "info");
					return;
				}

				if (subcommand === "refresh") {
					await runtime.refresh(ctx, ctx.model, true);

					// Refresh models catalog if auth available
					try {
						let apiKey: string | undefined;
						if (ctx.model?.provider === PROVIDER_NAME) {
							const auth = await ctx.modelRegistry?.getApiKeyAndHeaders?.(ctx.model);
							if (auth?.ok && auth.apiKey) {
								apiKey = auth.apiKey;
							}
						}
						if (!apiKey) {
							apiKey = await ctx.modelRegistry?.getApiKeyForProvider?.(PROVIDER_NAME);
						}
						if (!apiKey) {
							apiKey = process.env.HYPER_API_KEY;
						}
						const ctrl = new AbortController();
						await fetchHyperModels({ token: apiKey, signal: ctrl.signal });
					} catch {
						// Non-fatal if model refresh fails
					}

					const balance = runtime.getBalance();
					const balancePart = balance !== undefined ? ` Balance: ${formatCredits(balance)} HC` : "";
					ctx.ui.notify(`Hyper refreshed successfully.${balancePart}`, "info");
					return;
				}

				if (subcommand === "status") {
					const subArgs = tokens.slice(1).join(" ");
					await runtime.handleCommand(subArgs, ctx);
					return;
				}

				if (subcommand === "help") {
					ctx.ui.notify(renderHelpMessage(), "info");
					return;
				}

				if (subcommand !== "") {
					ctx.ui.notify(
						`Unknown subcommand '${subcommand}'. Usage: /hyper [credits | requests | stats | refresh | status | help]`,
						"warning",
					);
					return;
				}

				// Default dashboard view: /hyper
				if (runtime.getBalance() === undefined) {
					await runtime.refresh(ctx, ctx.model, true);
				}

				const summary = tracker.getSummary(undefined, sessionId);
				const activeModel = ctx.model?.provider === PROVIDER_NAME ? ctx.model : undefined;
				const rawModel = activeModel ? getCachedRawModel(activeModel.id) : undefined;

				const dashboardBox = renderDashboardBox({
					balance: runtime.getBalance(),
					lastRefreshedAt: runtime.getLastRefreshedAt(),
					error: runtime.getLastError(),
					tracking: summary,
					activeModel,
					rawModel,
				});

				ctx.ui.notify(dashboardBox, "info");
			} catch (error) {
				if (creditStatusState.kind === "disposed") return;
				ctx.ui.notify(`Hyper error: ${String(error)}`, "warning");
			}
		},
	});

	pi.registerCommand("hyper-status", {
		description: "Configure the Charm Hyper footer status (legacy alias)",
		getArgumentCompletions: (argumentPrefix: string) => {
			return getHyperStatusArgumentCompletions(argumentPrefix);
		},
		handler: async (args, ctx) => {
			try {
				const runtime = await loadCreditStatus();
				if (creditStatusState.kind === "disposed") return;
				await runtime.handleCommand(args, ctx);
			} catch (error) {
				if (creditStatusState.kind === "disposed") return;
				ctx.ui.notify(`Unable to load Hyper status support: ${String(error)}`, "warning");
			}
		},
	});

	// Subscribe to lifecycle and response events
	pi.on("model_select" as any, (event: any, ctx: ExtensionContext) => {
		const sessionId = ctx.sessionManager?.getSessionId?.();
		tracker.setActiveSession(sessionId);
		if (!ctx.hasUI) return;
		if (event?.model?.provider !== PROVIDER_NAME) {
			deactivateCreditStatus(ctx, event?.model);
			return;
		}
		scheduleCreditStatusRefresh(ctx, event.model);
	});

	pi.on("session_switch" as any, (_event: any, ctx: ExtensionContext) => {
		const sessionId = ctx.sessionManager?.getSessionId?.();
		tracker.setActiveSession(sessionId);
		if (!ctx.hasUI) return;
		if (ctx.model?.provider !== PROVIDER_NAME) {
			deactivateCreditStatus(ctx, ctx.model);
			return;
		}
		scheduleCreditStatusRefresh(ctx, ctx.model);
	});

	pi.on("turn_start", (_event, ctx) => {
		const sessionId = ctx.sessionManager?.getSessionId?.();
		tracker.setActiveSession(sessionId);
		if (!ctx.hasUI || ctx.model?.provider !== PROVIDER_NAME) return;
		scheduleCreditStatusRefresh(ctx, ctx.model);
	});

	pi.on("after_provider_response", (event, _ctx) => {
		if (event.headers) {
			tracker.updateServerRateLimits(event.headers);
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const isHyper =
			event.message.provider === PROVIDER_NAME ||
			(typeof event.message.model === "string" && event.message.model.startsWith("hyper/")) ||
			ctx.model?.provider === PROVIDER_NAME;

		if (!isHyper) return;

		const sessionId = ctx.sessionManager?.getSessionId?.();
		const usage = event.message.usage;
		tracker.recordRequest({
			model: event.message.responseModel ?? event.message.model,
			sessionId,
			usage: usage
				? {
						inputTokens: usage.input,
						cachedTokens: usage.cacheRead,
						cacheWriteTokens: usage.cacheWrite,
						outputTokens: usage.output,
						reasoningTokens: usage.reasoning,
						actualCostUsd: usage.cost?.total,
						actualCostHc: usage.cost?.total !== undefined ? usage.cost.total * HYPERCREDITS_PER_USD : undefined,
					}
				: undefined,
			timestamp: event.message.timestamp ?? Date.now(),
		});

		if (ctx.hasUI && ctx.model?.provider === PROVIDER_NAME) {
			scheduleCreditStatusRefresh(ctx, ctx.model);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		pendingCreditStatusRefresh = undefined;
		if (creditStatusRefreshWork !== undefined) clearImmediate(creditStatusRefreshWork);
		creditStatusRefreshWork = undefined;
		if (creditStatusState.kind === "ready") creditStatusState.runtime.dispose();
		creditStatusState = { kind: "disposed" };
		if (ctx.hasUI) ctx.ui.setStatus(PROVIDER_NAME, undefined);
	});
}
