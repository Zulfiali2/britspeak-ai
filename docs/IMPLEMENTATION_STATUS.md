# BritSpeak AI — Implementation status

This file is the persistent hand-over record. Update it at the end of every phase.

## Environment inspection (2026-10-27)

- New, empty project (GitHub repo `Zulfiali2/britspeak-ai` created empty by the owner; nothing to preserve).
- Node 22.22, npm 10.9, PostgreSQL 16 server available locally, Chromium + Playwright 1.63 preinstalled.
- `gh` CLI token invalid; pushes go through the session's authenticated git proxy instead.
- No provider credentials (Anthropic, Azure Speech, OpenAI, Stripe, Resend) are available in this environment,
  so every live-provider check is **pending** (see "Live verification" below).

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Architecture | Single Next.js 16 app (App Router) with a layered `src/server` backend | One deployable; no Python-only speech processing is needed because providers do the DSP. |
| Rendering | `cacheComponents` **off** | Almost every page is per-user; classic dynamic rendering keeps session reads simple and safe. |
| DB / ORM | PostgreSQL + Prisma 6.19 | Mature migrations; Prisma 7 changes driver/config model and gains nothing here. |
| Auth | First-party session auth: argon2id (`@node-rs/argon2`), DB-backed sessions with SHA-256-hashed tokens, httpOnly cookies, origin-checked mutations | Credentials auth with DB sessions, email verification, reset, and role checks without a third-party IdP. |
| LLM | Anthropic Claude (`claude-opus-5-5` default, `effort: low`, structured outputs, server-side refusal fallback) behind an `LlmProvider` interface | Validated JSON outputs for corrections; swappable. |
| STT | Azure AI Speech (en-GB, detailed output) or OpenAI transcription, behind `SttProvider` | Azure gives confidence + word timings for en-GB. |
| TTS | Azure neural voices (en-GB list fetched **live** from the provider) or OpenAI TTS; browser `speechSynthesis` as a labelled fallback | Never advertise a British voice that the provider has not listed. |
| Pronunciation | Azure Pronunciation Assessment (REST, en-GB) behind `PronunciationProvider` | Word + phoneme accuracy, fluency, completeness; Speechace documented as an alternative. |
| Real-time | OpenAI Realtime over WebRTC using short-lived client secrets minted server-side | Keys never reach the browser. |
| Billing | Stripe hosted Checkout + Customer Portal + verified, idempotent webhooks | Prices come from Stripe Price IDs, never hard-coded. |
| Rate limits / quotas | PostgreSQL-backed (no Redis) | Works on serverless without extra infrastructure; Redis can be added later. |
| Audio | Browser records → decodes → resamples to 16 kHz mono 16-bit WAV → server validates header/duration → provider. Audio is never stored. | One validated format accepted by every provider. |
| Tests | Vitest (unit + integration against a real Postgres test DB), Playwright E2E against a local **provider stub server** | Real adapters exercised end-to-end without credentials; stubbed output is never reported as live verification. |

## Phase checklist

- [ ] Phase 1 — Foundation: config, schema + migrations, auth, design system, layouts, onboarding, profile
- [ ] Phase 2 — Speaking MVP: recorder, STT, LLM conversation, TTS, studio, corrections
- [ ] Phase 3 — Pronunciation: Azure assessment, normalisation, lab, repeat-after-me attempts
- [ ] Phase 4 — Curriculum: lessons, role-plays, error history, spaced review, progress, Urdu explanations
- [ ] Phase 5 — Commercial: Stripe billing, entitlements, quotas, usage metering, admin, privacy controls
- [ ] Phase 6 — Production readiness: security review, full test run, docs, deployment/recovery

## Live verification (requires real credentials)

| Integration | Adapter implemented | Automated (stubbed) tests | Live smoke test |
| --- | --- | --- | --- |
| Anthropic Claude | – | – | pending |
| Azure STT | – | – | pending |
| Azure TTS + voice list | – | – | pending |
| Azure Pronunciation Assessment | – | – | pending |
| OpenAI STT / TTS | – | – | pending |
| OpenAI Realtime (WebRTC) | – | – | pending |
| Stripe Checkout / Portal / Webhooks | – | – | pending |
| Resend email | – | – | pending |

## Progress at pause (2026-10-27)

Done (Phase 1, partial):
- Next.js 16.4 scaffold, pinned dependencies, security headers/CSP (`next.config.ts`), `.gitignore`.
- Prisma schema + initial migration (`prisma/migrations/*_init`), all entities incl. usage, rate limits, audit, webhooks.
- Server core: validated config (`src/server/config/env.ts`), db, redacting JSON logger, AppError, `apiHandler`
  (auth, origin/CSRF check, DB rate limits, body limits, zod validation, request IDs).
- Auth: argon2id, DB sessions (hashed tokens), current-user DAL, email (Resend/console).
- Domain (pure, unit tested — 54 tests passing): session state, SM-2 review, entitlements, cost estimation,
  progress/streaks, ownership, transcript alignment, WAV validation, corrections post-processing,
  Azure pronunciation normalisation, phoneme articulation guide, lesson content schema.
- Providers: Anthropic (structured output, effort, server-side refusal fallback), Azure STT/TTS/voices/pronunciation,
  OpenAI STT/TTS/Realtime client secrets, resilience (timeout/retry/circuit breaker), registry.
- Services: usage/quotas, audit, auth, profile (export/delete), progress.

Known issues: `src/app/layout.tsx` is still the scaffold (tsc error on `LayoutProps`); no API routes or UI yet.

## Next step

1. Services: speech (transcribe/synthesize w/ lesson cache/assess), tutor prompts + turns, sessions, lessons,
   practice, daily challenge, baseline, billing (Stripe), admin, retention.
2. API routes under `src/app/api/v1/**`, health checks, `instrumentation.ts` config validation.
3. UI (design system, marketing, auth, onboarding, dashboard, studio, lab, admin), seed lessons.
4. Integration tests (`tests/support/integration-*` setup files referenced in vitest.config.ts are not written yet),
   provider stub server + Playwright E2E, docs, `.env.example`.

Local DB: `service postgresql start`; role `britspeak`/`britspeak_dev`, databases `britspeak_dev`, `britspeak_test`
(recreate in a new container — see the commands at the top of this session's log).
