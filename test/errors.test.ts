import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTransientCreditError } from "../src/credits.js";
import { HttpNetworkError, HttpResponseError, HttpTimeoutError } from "../src/http.js";

describe("Error Handling and Resilience", () => {
	it("correctly identifies transient HTTP errors", () => {
		// Network errors
		assert.ok(isTransientCreditError(new HttpNetworkError("Network failed", new Error("ECONNRESET"))));
		// Timeout errors
		assert.ok(isTransientCreditError(new HttpTimeoutError("Timeout", new Error("aborted"))));
		// 429 Rate Limit
		assert.ok(isTransientCreditError(new HttpResponseError(429, "Too Many Requests", { kind: "unavailable" }, 5000)));
		// 500 Internal Server Error
		assert.ok(isTransientCreditError(new HttpResponseError(500, "Internal Error", { kind: "unavailable" })));
		// 503 Service Unavailable
		assert.ok(isTransientCreditError(new HttpResponseError(503, "Unavailable", { kind: "unavailable" })));
	});

	it("identifies non-transient errors as fatal", () => {
		// 401 Unauthorized
		assert.ok(!isTransientCreditError(new HttpResponseError(401, "Unauthorized", { kind: "unavailable" })));
		// 403 Forbidden
		assert.ok(!isTransientCreditError(new HttpResponseError(403, "Forbidden", { kind: "unavailable" })));
		// 404 Not Found
		assert.ok(!isTransientCreditError(new HttpResponseError(404, "Not Found", { kind: "unavailable" })));
		// Standard generic Error
		assert.ok(!isTransientCreditError(new Error("Generic failure")));
	});
});
