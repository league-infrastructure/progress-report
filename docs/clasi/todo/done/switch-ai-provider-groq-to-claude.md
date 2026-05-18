---
title: Switch Report Generator from Groq to Claude Haiku
status: done
sprint: '002'
tickets:
- '004'
---

## Problem

The report generator (`POST /api/reviews/:id/generate-github-draft`) and the
Slack reminder service use the Groq API (`llama-3.3-70b-versatile`). The
stakeholder does not have a Groq API key — they have an Anthropic API key and
want to use Claude Haiku instead.

## Affected Files

- `server/src/routes/reviews.ts` — GitHub-to-review AI generation (lines ~354–746)
- `server/src/services/slackReminder.ts` — Slack DM reminder generation

## Tasks

1. **Install Anthropic SDK** if not already present: `@anthropic-ai/sdk`

2. **Update `reviews.ts`**: Replace Groq client and `llama-3.3-70b-versatile`
   calls with Anthropic client using `claude-haiku-4-5-20251001`. Read API key
   from `ANTHROPIC_API_KEY` env var (already defined in secrets template).

3. **Update `slackReminder.ts`**: Replace Groq client with Anthropic client,
   same model. Update the env var guard from `GROQ_API_KEY` to
   `ANTHROPIC_API_KEY`.

4. **Remove Groq dependency** (`groq-sdk`) from `package.json` once no longer
   used.

5. **Update env var documentation**: Remove `GROQ_API_KEY` references from
   `secrets.env.example` and any config docs; confirm `ANTHROPIC_API_KEY` is
   documented as required.

## Acceptance Criteria

- [ ] `GROQ_API_KEY` is no longer referenced anywhere in application code
- [ ] Report generation calls Anthropic API with `claude-haiku-4-5-20251001`
- [ ] Slack reminder generation calls Anthropic API with same model
- [ ] `groq-sdk` removed from `package.json` / `node_modules`
- [ ] `ANTHROPIC_API_KEY` is documented in `secrets.env.example` as required
- [ ] Existing report generation tests (if any) updated to mock Anthropic SDK
