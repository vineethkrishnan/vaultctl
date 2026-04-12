// k6 baseline load test for vaultctl.
//
// Milestone 15 acceptance criterion: p95 < 200ms at 100 RPS with 100
// concurrent users against a freshly-built vaultctl server.
//
// This script is intentionally read-only against unauthenticated endpoints
// (/health, /config, /auth/prelogin). Authenticated endpoints require
// client-side Argon2id + AES-GCM + HKDF, which k6's JS runtime can't run
// without shelling out — we'd hit the Go server's 64 MiB Argon2 cost on
// every virtual user and the test would measure the KDF, not the server.
// A separate k6 script in follow-up work will exercise the authenticated
// surface using pre-derived tokens.
//
// Run locally (against a docker-compose'd instance):
//   k6 run test/load/k6-baseline.js --env VAULTCTL_URL=https://localhost:8080
//
// Run in CI: see .github/workflows/load.yml

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend } from "k6/metrics";

// ---------------------------------------------------------------------------
// Config — env-overridable for local vs CI vs staging
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.VAULTCTL_URL || "http://localhost:8080";
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || "1m";
const PRELOGIN_EMAIL =
  __ENV.PRELOGIN_EMAIL || "loadtest@example.invalid";

// Per-endpoint latency trends so reports show where budget is spent
const healthTrend = new Trend("vaultctl_health_duration", true);
const configTrend = new Trend("vaultctl_config_duration", true);
const preloginTrend = new Trend("vaultctl_prelogin_duration", true);

export const options = {
  scenarios: {
    baseline: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
      gracefulStop: "10s",
    },
  },
  thresholds: {
    // Milestone 15 hard gate: the whole session's p95 MUST be under 200ms.
    http_req_duration: ["p(95)<200"],
    // Less than 1% of requests allowed to fail. Pre-login against an
    // unknown email is NOT a failure — the server returns 200 with an
    // H2 enumeration-safe fake salt.
    http_req_failed: ["rate<0.01"],
    vaultctl_health_duration: ["p(95)<50"],
    vaultctl_prelogin_duration: ["p(95)<150"],
  },
  // Reject TLS trust issues in production runs; relax only when explicitly
  // told to (e.g. dev snakeoil cert inside docker compose).
  insecureSkipTLSVerify: __ENV.VAULTCTL_INSECURE_SKIP_VERIFY === "1",
};

// ---------------------------------------------------------------------------
// Default scenario — one iteration per VU per loop
// ---------------------------------------------------------------------------

export default function () {
  group("health", () => {
    const res = http.get(`${BASE_URL}/api/v1/health`, {
      tags: { endpoint: "health" },
    });
    healthTrend.add(res.timings.duration);
    check(res, {
      "health: status 200": (r) => r.status === 200,
      "health: body has status": (r) =>
        typeof r.body === "string" && r.body.includes("ok"),
    });
  });

  group("config", () => {
    const res = http.get(`${BASE_URL}/api/v1/config`, {
      tags: { endpoint: "config" },
    });
    configTrend.add(res.timings.duration);
    check(res, {
      "config: status 200": (r) => r.status === 200,
    });
  });

  group("prelogin", () => {
    // H2 enumeration test: an unknown email MUST return 200 with a fake
    // salt in constant time. Track its duration to flag regressions that
    // would give an attacker a side-channel signal.
    const res = http.get(
      `${BASE_URL}/api/v1/auth/prelogin?email=${encodeURIComponent(PRELOGIN_EMAIL)}`,
      { tags: { endpoint: "prelogin" } },
    );
    preloginTrend.add(res.timings.duration);
    check(res, {
      "prelogin: status 200": (r) => r.status === 200,
      "prelogin: has salt": (r) =>
        typeof r.body === "string" && r.body.includes("salt"),
    });
  });

  // Small think-time so 100 VUs don't generate >>100 RPS instantaneously
  sleep(1);
}

// ---------------------------------------------------------------------------
// Summary handler — emits a machine-readable JSON summary alongside the
// default stdout report. CI picks this up for the build gate.
// ---------------------------------------------------------------------------

export function handleSummary(data) {
  return {
    stdout: textSummary(data),
    "test/load/.k6-summary.json": JSON.stringify(data, null, 2),
  };
}

// Trimmed stdout summary — k6's own helper is installed as a module in CI
// but we write a minimal version so `k6 run` works locally without the
// extension being installed.
function textSummary(data) {
  const m = data.metrics;
  const fmt = (v) => (v === undefined ? "—" : `${v.toFixed(2)}ms`);
  const rate = (v) => (v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);

  return `
vaultctl k6 baseline summary
============================
  VUs              : ${data.state?.testRunDurationMs ? VUS : "?"}
  Duration         : ${DURATION}
  Scenarios        : ${Object.keys(data.root_group?.groups ?? {}).join(", ")}

  http_req_duration p95 : ${fmt(m.http_req_duration?.values?.["p(95)"])}
  http_req_failed       : ${rate(m.http_req_failed?.values?.rate)}

  per-endpoint p95:
    health   : ${fmt(m.vaultctl_health_duration?.values?.["p(95)"])}
    config   : ${fmt(m.vaultctl_config_duration?.values?.["p(95)"])}
    prelogin : ${fmt(m.vaultctl_prelogin_duration?.values?.["p(95)"])}
`;
}
