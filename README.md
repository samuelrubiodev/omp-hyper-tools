# omp-hyper-tools

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An enhanced [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) extension for Charm's [Hyper](https://hyper.charm.land) inference provider, ported from `pi-hyper-tools` with full feature parity.

This extension provides an interactive `/hyper` terminal dashboard, dynamic server rate-limit detection from HTTP response headers, live Hypercredit balance tracking, dual cost accounting, detailed token & cache statistics, multimodal vision support, and interactive slash command autocomplete for OMP.

```sh
# Install in OMP from git
omp plugin install git:github.com/samuelrubiodev/omp-hyper-tools

# Install in OMP from npm
omp plugin install npm:omp-hyper-tools

# Or install from local directory during development
omp plugin install /path/to/omp-hyper-tools
```

---

## Features

- **Interactive `/hyper` Dashboard**: A polished ASCII terminal box displaying live credit balance, dynamic server rate limits, active model pricing, cache hit rate, and session usage.
- **Multimodal & Vision Support**: Automatically resolves image/attachment capabilities per model from `/v1/models` (`capabilities.vision`), enabling image attachments for Qwen, Kimi, MiniMax, GLM Flash, etc.
- **Dynamic Server Rate Limits**: Inspects HTTP response headers (`x-ratelimit-*`) on live inference requests to automatically detect hourly and daily rate limits and remaining requests without hardcoding account tiers.
- **Dual Cost Accounting**: Captures server-reported actual request costs when returned by Hyper alongside pricing formula calculations based on input, output, cache-read, and cache-write rates.
- **Subcommand Autocomplete**: Interactive autocomplete suggestions when typing `/hyper ` or `/hyper status ` in the OMP editor.
- **Detailed Usage Analytics**: `/hyper stats` breaks down uncached input tokens, cached tokens, reasoning tokens, and cache hit rates.
- **Explicit Request Accounting**: `/hyper requests` clearly distinguishes authoritative server-reported limits from local session/machine request counts.
- **Configurable Status Line**: Live footer status showing credit balance and team name via `/hyper status`.

---

## Authentication

### OAuth / Subscription (Recommended)

1. Open `omp`.
2. Run `/login`.
3. Choose **Subscription** and select **Charm Hyper**.
4. Complete the device authorization flow in your browser.

### API Key

Set the `HYPER_API_KEY` environment variable in your shell:

```sh
export HYPER_API_KEY="your-hyper-api-key"
```

Then launch `omp`.

---

## Supported Models & Capabilities

List and select available Hyper models using OMP's model selector (<kbd>F2</kbd> or `/models`) or CLI:

```text
/model hyper
```

Or via CLI flag:

```sh
omp --model hyper/deepseek-v4-flash
```

### Models Overview

| Model ID | Context Window | Max Output | Thinking / Reasoning | Vision (Images) | Input Price / 1M | Output Price / 1M |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `hyper/deepseek-v4-flash` | 1M | 384K | high, xhigh | No | $0.20 | $0.40 |
| `hyper/deepseek-v4-flash-0731` | 1M | 384K | none, low, high, max | No | $0.44 | $1.32 |
| `hyper/deepseek-v4-pro` | 1M | 384K | high, xhigh | No | $2.40 | $4.80 |
| `hyper/deepseek-v4-pro-0813` | 1M | 384K | none, low, high, max | No | $1.44 | $4.31 |
| `hyper/glm-5.2` | 1M | 384K | high, xhigh | No | $1.52 | $4.79 |
| `hyper/glm-5.3` | 1M | 384K | low, high, max | No | $1.52 | $4.79 |
| `hyper/glm-5.3-flash` | 1M | 131K | low, high, max | **Yes** | $0.16 | $0.54 |
| `hyper/gpt-oss-120b` | 128K | 128K | minimal to max | No | $0.19 | $0.63 |
| `hyper/kimi-k2.6` | 262K | 262K | low, medium, high | **Yes** | $1.03 | $4.36 |
| `hyper/kimi-k2.7-code` | 262K | 262K | minimal, low, medium, high | **Yes** | $1.03 | $4.36 |
| `hyper/kimi-k3` | 1M | 384K | low, high, max | **Yes** | $3.27 | $16.33 |
| `hyper/minimax-m3` | 512K | 512K | low, medium, high | **Yes** | $0.33 | $1.31 |
| `hyper/qwen3.6-flash` | 1M | 384K | minimal, low, medium, high | **Yes** | $1.00 | $4.00 |
| `hyper/qwen3.6-plus` | 1M | 384K | minimal, low, medium, high | **Yes** | $2.00 | $6.00 |
| `hyper/qwen3.7-flash` | 1M | 384K | minimal, low, medium, high | **Yes** | $0.20 | $0.80 |
| `hyper/qwen3.7-max` | 1M | 384K | minimal, low, medium, high | No | $2.50 | $7.50 |
| `hyper/qwen3.7-plus` | 1M | 384K | minimal, low, medium, high | **Yes** | $1.20 | $4.80 |
| `hyper/qwen3.8-27b` | 1M | 384K | minimal, low, medium, high | **Yes** | $0.50 | $3.00 |
| `hyper/qwen3.8-flash` | 1M | 384K | minimal, low, medium, high | **Yes** | $0.15 | $0.47 |
| `hyper/qwen3.8-max` | 1M | 384K | minimal, low, medium, high | **Yes** | $2.00 | $6.00 |

---

## Commands

All `/hyper` commands include full argument autocompletion. Simply type `/hyper ` in the OMP editor to see interactive suggestions for all available subcommands (`credits`, `requests`, `stats`, `refresh`, `status`, `help`).

### `/hyper`

Displays the compact, complete Hyper dashboard:

```text
╭─ Hyper ───────────────────────────╮
│                                    │
│ Hypercredits                       │
│   250.00 HC   ($12.50)             │
│                                    │
│ Rate Limits                        │
│   Hour: 992 / 1000 remaining       │
│   Day:  9562 / 10000 remaining     │
│                                    │
│ Model                              │
│   DeepSeek V4 Flash                │
│                                    │
│ Pricing                            │
│   Input:       $0.20 / 1M          │
│   Cache read:  $0.04 / 1M          │
│   Output:      $0.40 / 1M          │
│                                    │
│ Cache                              │
│   Session hit rate: 95.4%          │
│                                    │
│ Usage                              │
│   Session:  0.02 HC  ($0.0008)     │
│                                    │
╰────────────────────────────────────╯
```

### `/hyper credits`

Shows your authoritative Hypercredit balance, USD value, and last refresh timestamp:

```text
Hypercredits (authoritative server-side balance)

  Balance:         250.00 HC
  USD Equivalent:  $12.50
  Last Refreshed:  just now
```

### `/hyper requests`

Displays authoritative server rate limits and local session request counts:

```text
Requests

Server reported limits
  Hour: 992 remaining / 1000
  Day:  9562 remaining / 10000
  Last server update: just now

Local activity
  Hour: 1 request
  Day:  1 request

Note: Server limits are authoritative from Hyper response headers. Local activity counts inference requests made from this OMP session/machine.
```

### `/hyper stats`

Displays token usage, reasoning tokens, cache hit rate, and estimated vs server-reported costs for both the current session and today's aggregate usage:

```text
Hyper Usage Statistics

Session Usage
  Inference Requests:    12
  Uncached Input Tokens: 8,509
  Cached Input Tokens:   174,912
  Total Input Tokens:    183,421
  Cache Hit Rate:        95.4% (cached / (uncached + cached))
  Output Tokens:         4,200
  Reasoning Tokens:      1,800
  Total Tokens:          187,621
  Estimated Cost:        $0.14 (2.8400 HC)
  Server Reported Cost:  $0.14 (2.8300 HC)

Today's Aggregate Usage
  Inference Requests:    45
  Uncached Input Tokens: 30,000
  Cached Input Tokens:   500,000
  Total Input Tokens:    530,000
  Cache Hit Rate:        94.3% (cached / (uncached + cached))
  Output Tokens:         15,000
  Reasoning Tokens:      6,000
  Total Tokens:          545,000
  Estimated Cost:        $0.45 (9.0000 HC)
  Server Reported Cost:  $0.45 (8.9800 HC)
```

### `/hyper refresh`

Bypasses local caches to fetch fresh balance data from `/v1/credits` and model pricing catalogs from `/v1/models` and `/v1/provider`.

### `/hyper status`

Interactive or CLI configuration for the OMP footer status line:

```sh
/hyper status teamName true
/hyper status hypercredits false
/hyper status reset
```

*(Legacy alias `/hyper-status` is also supported).*

---

## Data Accounting & Sources of Truth

The extension separates sources of truth across distinct categories:

| Category | Metric | Source | Nature |
| :--- | :--- | :--- | :--- |
| **Balance** | Hypercredits | `GET /v1/credits` | **Authoritative**: Real server-side balance from Hyper account. |
| **Rate Limits** | Hourly & Daily Limits / Remaining | Inference HTTP Headers (`x-ratelimit-*`) | **Authoritative**: Real server rate limits currently applied to the account. |
| **Model Metadata & Vision** | Attachments & Capabilities | `GET /v1/models` | **Authoritative**: Real model specifications and multimodal vision capabilities (`capabilities.vision`). |
| **Model Pricing** | Rates per 1M tokens | `GET /v1/models` / `GET /v1/provider` | **Authoritative**: Real rates for input, output, cache-read, and cache-write. |
| **Activity** | Local Request Counters | Local Tracker | **Local Activity**: Counts model inference calls originating from this OMP installation. |
| **Cost** | Actual vs Estimated Cost | Completion chunk / Model rates | **Dual**: Server-reported cost when provided by Hyper, alongside local rate formula estimates. |

---

## Privacy & Local Storage

- Local persistence is stored in `~/.omp/agent/hyper-provider/` (`settings.json` and `usage.json`).
- Stored records contain **only metadata**: timestamp, model ID, token counts, rate limits, and cost calculations.
- **Zero prompt text, zero model responses, zero tool arguments, and zero conversation content** are ever persisted or sent outside inference calls.
- Historical usage records older than 30 days are automatically pruned to keep file sizes negligible (< 50 KB).

---

## Development & Testing

Run the unit test suite:

```sh
npm test
```

Run TypeScript type checking:

```sh
npm run typecheck
```

Run formatting and linting:

```sh
npm run check:biome
```

Run live API verification (requires `HYPER_API_KEY`):

```sh
bun test/integration.live.ts
```

---

## License

Licensed under the [MIT License](LICENSE).
