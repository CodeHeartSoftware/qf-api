## What does this PR change?

<!-- One or two sentences. -->

## Checklist

- [ ] `yarn lint && yarn format:check && yarn typecheck && yarn test` pass.
- [ ] If a model (`bots/stock-market-4/*`) changed: its own `npm test` passes and `docker build` succeeds.
- [ ] If `packages/bot-sdk-js` or `packages/stock-market-4/quant-sdk-js` changed: the models' vendored
      tarballs were repacked (`scripts/pack-*.sh`).
- [ ] Tests were added or updated, and the relevant README/ADR updated if a core abstraction changed.
