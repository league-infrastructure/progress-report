---
id: '004'
title: Replace Groq with Anthropic Claude Haiku
status: done
use-cases:
- SUC-003
depends-on: []
github-issue: ''
todo: switch-ai-provider-groq-to-claude.md
completes_todo: true
---

# Replace Groq with Anthropic Claude Haiku

## Description

The report generator (`POST /api/reviews/:id/generate-github-draft`) and the
Slack reminder service use the Groq API with `llama-3.3-70b-versatile`. The
stakeholder has an Anthropic API key, not a Groq key. `ANTHROPIC_API_KEY` is
already in the secrets template but unused. `groq-sdk` is in `package.json`.

This ticket:
1. Installs `@anthropic-ai/sdk`.
2. Replaces Groq calls in `reviews.ts` and `slackReminder.ts` with Anthropic calls.
3. Removes `groq-sdk` from `package.json`.
4. Updates documentation so `ANTHROPIC_API_KEY` is marked required and
   `GROQ_API_KEY` is removed.

This ticket is independent of tickets 001-003 and can execute in parallel.

## Acceptance Criteria

- [ ] `groq-sdk` is removed from `server/package.json`.
- [ ] `@anthropic-ai/sdk` is present in `server/package.json` dependencies.
- [ ] `GROQ_API_KEY` does not appear anywhere in application code or config files.
- [ ] `POST /api/reviews/:id/generate-github-draft` calls Anthropic API with
      `claude-haiku-4-5-20251001` and returns a correctly structured draft body.
- [ ] If `ANTHROPIC_API_KEY` is not set, the endpoint returns 500 with the
      message "ANTHROPIC_API_KEY is not configured on the server".
- [ ] The Slack reminder service uses Anthropic when `ANTHROPIC_API_KEY` is set;
      falls back to static text when it is not.
- [ ] `ANTHROPIC_API_KEY` is documented as required in all secrets example files
      (`config/dev/secrets.env.example`, `config/prod/secrets.env.example`,
      `secrets/dev.env.example`, `secrets/prod.env.example`).
- [ ] All existing tests pass after the change.

## Implementation Plan

### Approach

Surgical find-and-replace in two server files plus a `package.json` change.
No prompt content changes. No schema changes.

### Files to Modify

- `server/package.json` — remove `groq-sdk`, add `@anthropic-ai/sdk`
- `server/src/routes/reviews.ts` — swap Groq client for Anthropic client
- `server/src/services/slackReminder.ts` — same swap
- `config/dev/secrets.env.example` — confirm/update `ANTHROPIC_API_KEY` comment
- `config/prod/secrets.env.example` — same
- `secrets/dev.env.example` — confirm/update
- `secrets/prod.env.example` — confirm/update

### Step 1: Install/remove packages

```bash
cd server
npm uninstall groq-sdk
npm install @anthropic-ai/sdk
```

Pin the installed version in `package.json` after running — check the installed
version with `npm list @anthropic-ai/sdk` and confirm `^` pinning is appropriate.

### Step 2: Update `server/src/routes/reviews.ts`

**Remove:**
```typescript
import Groq from 'groq-sdk';
```

**Add:**
```typescript
import Anthropic from '@anthropic-ai/sdk';
```

**Replace the guard (around line 660):**

Before:
```typescript
if (!process.env.GROQ_API_KEY) {
  res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
  return;
}
const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const completion = await client.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  max_tokens: 1024,
  messages: [
    { role: 'system', content: `<system prompt>` },
    { role: 'user', content: `<user prompt>` },
  ],
});
const llmBody = (completion.choices[0]?.message?.content ?? '').trim();
```

After:
```typescript
if (!process.env.ANTHROPIC_API_KEY) {
  res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
  return;
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const response = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  system: `<same system prompt string>`,
  messages: [{ role: 'user', content: `<same user prompt string>` }],
});
const llmBody = (response.content[0] as { type: 'text'; text: string }).text.trim();
```

The prompts (both `system` and `user` content strings) are copied verbatim from
the existing Groq call. Only the client call shape and response accessor change.

### Step 3: Update `server/src/services/slackReminder.ts`

**Remove:**
```typescript
import Groq from 'groq-sdk';
```

**Add:**
```typescript
import Anthropic from '@anthropic-ai/sdk';
```

**Replace the guard and client call (around lines 76-107):**

Before:
```typescript
if (process.env.GROQ_API_KEY) {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 256,
      messages: [
        { role: 'system', content: `<system prompt>` },
        { role: 'user', content: `<user prompt>` },
      ],
    });
    const generated = completion.choices[0]?.message?.content?.trim();
    if (generated) text = generated;
  } catch { /* fall through to static text */ }
}
```

After:
```typescript
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: `<same system prompt string>`,
      messages: [{ role: 'user', content: `<same user prompt string>` }],
    });
    const generated = (response.content[0] as { type: 'text'; text: string }).text.trim();
    if (generated) text = generated;
  } catch { /* fall through to static text */ }
}
```

Again: prompts are identical; only client call shape and response accessor differ.

### Step 4: Update secrets documentation

The `config/*/secrets.env.example` files already contain:
```
# --- AI Services ---
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Update the comment to mark it as required:
```
# --- AI Services ---
# Required for review generation and Slack reminder AI enhancement
ANTHROPIC_API_KEY=your-anthropic-api-key
```

If `GROQ_API_KEY` appears in any of the four example files, remove it.
Verify all four files: `config/dev/secrets.env.example`,
`config/prod/secrets.env.example`, `secrets/dev.env.example`,
`secrets/prod.env.example`.

### Testing Plan

**New tests** (`tests/server/reviewGeneration.test.ts` or add to existing):

- Mock `@anthropic-ai/sdk`: when `ANTHROPIC_API_KEY` is set and the mock
  returns a message, the endpoint returns a 200 with `body`, `commitCount`,
  `repoCount`.
- When `ANTHROPIC_API_KEY` is absent, the endpoint returns 500 with the
  correct error message.

Use `jest.mock('@anthropic-ai/sdk')` to stub the Anthropic client.

**Existing tests to run:** `npm run test:server` — no regressions expected
since the prompt content and route logic are unchanged. TypeScript compile
(`npx tsc --noEmit`) must pass.

**Manual verification:** Set `ANTHROPIC_API_KEY` in dev env, open a review
with a linked GitHub student, and click "Generate Draft" to confirm end-to-end.
