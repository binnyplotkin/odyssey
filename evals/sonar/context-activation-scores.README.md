# Sonar Context Activation scores

Context Activation measures the content-management and knowledge-graph path:
retrieval, curation, cache reuse, and prompt-context injection.

Create or update `evals/sonar/context-activation-scores.jsonl` with:

```sh
npm run sonar -- run --suite context-activation-baseline --label "context baseline"
npm run sonar -- score-context --latest
npm run sonar -- score-context --run-id <run-prefix>
npm run sonar -- score-context --file .sonar/runs/<file>.json --dry-run
```

The scorer is deterministic. It reads `serverTrace` from `.sonar/runs/*.json`
and does not call a judge model. When the file is absent,
`npm run benchmark -- report` shows Context Activation as `not scored`.

```json
{"runId":"...","at":"2026-06-16T00:00:00.000Z","sonarVersion":"0.1.0","suite":"context-activation-baseline","suiteVersion":"0.1.0","model":"gpt-oss-120b","turns":6,"dimensions":{"contextAvailability":100,"retrievalRecall":80,"retrievalPrecision":70,"curationSelectivity":100,"tokenEfficiency":80,"cacheEffectiveness":100,"retrievalLatency":90,"curatorLatency":95,"contextAttachLatency":100},"score":88.2,"metrics":{"turns":6,"tracedTurns":6,"contextTurns":6,"retrievalTurns":1,"cacheEligibleTurns":5,"cacheHits":5,"retrievalSkippedTurns":0,"labeledTurns":6,"pageRecall":0.8,"pagePrecision":0.7,"forbiddenPageHits":0,"selectedPageSlugs":["three-visitors-at-mamre"],"expectedPageSlugs":["three-visitors-at-mamre"],"avgSemanticHits":1.7,"avgSelectedPages":2.5,"avgWikiPromptChars":16700,"avgTokenBudgetUse":0.9,"retrievalMs":{"count":1,"min":900,"max":900,"mean":900,"p50":900,"p90":900,"p95":900},"curatorMs":null,"contextAttachMs":null},"notes":"Short rationale for bottlenecks."}
```

Dimensions are scored 0-100:

- `contextAvailability`: traced turns with attached context.
- `retrievalRecall`: selected expected page slugs divided by expected page
  slugs. Older unlabeled traces fall back to a proxy.
- `retrievalPrecision`: matched selected page slugs divided by selected page
  slugs, minus forbidden-page drift.
- `curationSelectivity`: selected pages stay focused rather than broad.
- `tokenEfficiency`: curator stays within the context token budget.
- `cacheEffectiveness`: cache hit rate after the first turn in a session.
- `retrievalLatency`: retrieval p50, lower is better.
- `curatorLatency`: curator p50, lower is better.
- `contextAttachLatency`: request received to context attached p50, lower is
  better.

`context-activation-baseline` is gold-labeled for page activation. Future
versions can add required terms and entity-level labels on top of the page
recall/precision score.
