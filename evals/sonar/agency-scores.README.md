# Sonar Agency scores

`agency-baseline` produces the run trace. Agency scoring is a separate
judgment step because latency is not a valid proxy for conversation control.

Create or update `evals/sonar/agency-scores.jsonl` with:

```sh
npm run sonar -- judge-agency --latest
npm run sonar -- judge-agency --run-id <run-prefix>
npm run sonar -- judge-agency --file .sonar/runs/<file>.json --dry-run
```

The file is optional; when it is absent, `npm run benchmark -- report` shows
Agency as `not judged`.

```json
{"runId":"...","at":"2026-06-16T00:00:00.000Z","sonarVersion":"0.1.0","suite":"agency-baseline","suiteVersion":"0.1.0","model":"gpt-oss-120b","turns":10,"judge":"manual-v0","dimensions":{"turnTaking":80,"interruptability":70,"engagement":85,"initiative":75,"repair":70,"goalPersistence":80,"worldResponsiveness":78},"notes":"Short rationale for failures and regressions."}
```

Dimensions are scored 0-100:

- `turnTaking`: natural stop/resume/handoff behavior.
- `interruptability`: accepts a stop, correction, or changed intent without
  continuing the old track.
- `engagement`: specific, situated, emotionally alive response quality.
- `initiative`: offers the next useful question, choice, or action.
- `repair`: recovers after confusion, partial information, or misread intent.
- `goalPersistence`: keeps the larger session purpose across turns.
- `worldResponsiveness`: advances scene state, character presence, and narrator
  mediation appropriately.

The judge computes a weighted score and subtracts severe-failure penalties,
capped at 30 points per run. The benchmark report reads the final `score`.
