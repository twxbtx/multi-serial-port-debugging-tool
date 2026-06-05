# CLAUDE.md

Codex compatibility guidance adapted from the public `forrestchang/andrej-karpathy-skills` project.

## Project Skill Defaults

- For non-trivial coding, review, refactoring, debugging, UI, or verification work, apply `$karpathy-guidelines`: think before coding, prefer simple solutions, make surgical changes, and verify against explicit success criteria.
- Read `AGENTS.md` together with this file when present. If instructions conflict, higher-priority system, developer, or user instructions win.

## 1. Think Before Coding

- State important assumptions before implementing non-trivial changes.
- If ambiguity changes the implementation path, surface the tradeoff instead of silently choosing.
- Push back gently when a simpler or safer path exists.
- If guessing could create churn, pause and clarify.

## 2. Simplicity First

- Use the minimum code needed to solve the requested problem.
- Avoid speculative features, broad configurability, or single-use abstractions.
- Prefer direct, readable fixes over clever frameworks.
- If a change starts growing beyond the problem, simplify before continuing.

## 3. Surgical Changes

- Touch only code paths that directly support the request.
- Match existing project style.
- Do not refactor, reformat, or delete unrelated code while fixing the current issue.
- Clean up only unused code introduced by your own changes.
- Mention unrelated dead code or risks instead of deleting them.

## 4. Goal-Driven Execution

- Convert non-trivial work into explicit success criteria.
- Verify fixes with tests, browser automation, build checks, or targeted simulations.
- Loop until checks pass, or report the exact blocker.
- For multi-step work, keep brief checkpoints: what changed, what was verified, and what remains.

## 5. Models For Judgment Only

- Use LLMs for classification, drafting, summarization, and extraction from unstructured text.
- Do not use LLMs for routing decisions, retry logic, status code handling, or deterministic transformations.
- If code can decide, code should decide.

## 6. Hard Token Budget

- Single task output target: about 4K tokens.
- Single session target: about 30K tokens.
- Near the limit, summarize and restart fresh instead of silently overflowing.
- Actively surface over-budget risk.

## 7. Expose Conflicts, Do Not Average

- If two patterns in the codebase conflict, pick one, usually the newer or better-tested pattern.
- State the reasoning and mark the other for future cleanup.
- Avoid averaged code that satisfies neither pattern.

## 8. Read First, Then Write

- Before adding to a file, read its exports, direct callers, and shared utilities.
- Do not assume nearby code is unrelated without checking.
- If the existing structure is unclear, ask or inspect more before editing.

## 9. Tests Verify Intent, Not Just Behavior

- Each test should encode why the behavior matters, not only what it does.
- A test that would not fail when business logic changes is weak.
- Match the test scope to the risk and blast radius of the change.

## 10. Checkpoints For Long Operations

- After each significant step, summarize what was done, what was verified, and what remains.
- Never proceed from a state that cannot be clearly described.
- If context is lost, stop and re-orient before continuing.

## 11. Follow Codebase Conventions

- Follow the naming, formatting, and architecture already used in the touched area.
- Existing project patterns take priority over personal preference.
- If a convention is genuinely harmful, flag it explicitly instead of silently introducing an alternative.

## 12. Make Failures Visible

- Do not claim success if records were skipped, tests were skipped, or boundary cases were not verified.
- Report uncertainty and skipped checks plainly.
- Default to exposing uncertainty instead of hiding it.

---

## Project Context

### Environment

- Platform: Windows 11, PowerShell 5.1.
- Primary tools: Claude Code, Codex, CodeBuddy, Cursor, DeepseekTUI, VS Code, Trae CN.
