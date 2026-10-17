# ADR-0007: Repository Enforcement of the Platform/Competitor Boundary

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

A competitor's bot submission PR must be structurally prevented from modifying platform code,
game rule code, or another competitor's bot directory. Documentation ("please only touch your own
bot directory") is not a control. The mechanism must be automated, and must not depend on reviewer
diligence alone.

## Decision

### CODEOWNERS is necessary but not sufficient

`.github/CODEOWNERS` requires `@thunderdome/maintainers` review on the entire repository, including
`bots/**` — because executing arbitrary community-submitted code is inherently risky even when a
bot's manifest looks clean — plus `@thunderdome/game-stewards` review (in addition to maintainer
review) on `games/**`, since games run in-process.

CODEOWNERS controls _who must approve_, not _what paths a single PR is allowed to touch together_.
It cannot stop a PR from bundling `bots/alice-bot/**` with a change to `packages/engine/**` under
one approval, and it cannot stop a maintainer from accidentally approving a boundary-violating
mixed-scope PR during a high-volume review day. A second, mechanical mechanism is required for
that specific gap.

### CI boundary-check as a required, mechanical gate

`ci/tools/boundary-check`, run in CI as a required status check (`.github/workflows/boundary-check.yml`),
inspects the PR's actual changed-file list and enforces:

1. A PR touching any `bots/**` path must not also touch any non-bot path (`packages/**`,
   `apps/**`, `games/**`, `ci/**`, root config), **unless** a maintainer applies a
   `maintainer-override` label. Label application is gated by GitHub's own collaborator-permission
   model, so a fork-based competitor cannot self-apply it — no extra actor-identity check is
   needed in the script itself.
2. A PR touching `bots/**` must stay within exactly one `bots/<game-id>/<bot-id>/` directory — a
   competitor cannot modify another competitor's bot, even one grouped under the same game.
3. Any changed `manifest.json` (bot or game) must pass its Zod schema, have `id` matching its
   directory name, not collide with an existing id elsewhere in the repo, and — for bots — have
   `game` matching the `bots/<game-id>/` grouping it's nested under.

Any failure is a non-zero exit, surfaced as a required, merge-blocking status check.

### Games-touching-platform PRs are intentionally not mechanically blocked

A PR that touches both `packages/game-sdk` (a contract change) and `games/chess` (adapting to it)
is common and legitimate — that combination is already gated by mandatory maintainer + steward
review via CODEOWNERS. Adding a mechanical block there would add friction without closing a real
gap. The mechanical gate is reserved specifically for `bots/**`, because that's the one boundary
that a high volume of low-scrutiny, look-similar community PRs needs a hard backstop for —
"please review carefully" doesn't scale the same way maintainer review of a handful of game/
platform PRs does.

### Once a remote exists

`ci.yml` (lint/typecheck/vitest/build) and `boundary-check.yml` are both marked required status
checks in `main`'s branch protection, alongside "Require review from Code Owners." This is a
follow-up action once the repository has a GitHub remote — the workflow files are authored now,
but branch protection itself cannot be configured before that.

## Consequences

- A bot submission that also edits platform code fails CI immediately, with a clear message,
  before it ever reaches human review.
- Maintainers retain an explicit, audited escape hatch (`maintainer-override`) for legitimate
  cross-cutting platform PRs, without weakening the default for competitor submissions.
- `ci/tools/boundary-check` is a real, independently testable package (own Vitest suite) — the
  enforcement logic is not "a shell script nobody has tests for."
