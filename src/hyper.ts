import { createRequire } from "node:module";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const packageJsonPayload: unknown = require("../package.json");
const packageJson = parsePackageJson(packageJsonPayload);
const packageName = packageJson.name.split("/").at(-1) ?? "pi-hyper-provider";

export const PROVIDER_NAME = "hyper";
export const PROVIDER_DISPLAY_NAME = "Charm Hyper";
export const HYPER_BASE_URL = "https://hyper.charm.land";
export const HYPER_API_BASE_URL = `${HYPER_BASE_URL}/v1`;
export const HYPER_API_KEY = "$HYPER_API_KEY";
export const HYPER_USER_AGENT = `${packageName}/${packageJson.version}`;

/** Conversion rate: 1 Hypercredit = $0.05 USD (20 Hypercredits per $1 USD). */
export const USD_PER_HYPERCREDIT = 0.05;
export const HYPERCREDITS_PER_USD = 20;

export const HYPER_GEM = "\x1b[38;2;255;96;255m◆\x1b[39m";

export function hyperProviderDir(): string {
	return path.join(getAgentDir(), "hyper-provider");
}

export function hyperJsonHeaders(headers: Record<string, string> = {}): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"User-Agent": HYPER_USER_AGENT,
		...headers,
	};
}

function parsePackageJson(payload: unknown): { name: string; version: string } {
	if (!isRecord(payload)) throw new Error("package.json must contain a JSON object");
	const name = property(payload, "name");
	const version = property(payload, "version");
	if (typeof name !== "string" || !name.trim()) throw new Error("package.json must contain a name");
	if (typeof version !== "string" || !version.trim()) throw new Error("package.json must contain a version");
	return { name, version };
}

function property(source: Record<string, unknown>, key: string): unknown {
	return Object.getOwnPropertyDescriptor(source, key)?.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
