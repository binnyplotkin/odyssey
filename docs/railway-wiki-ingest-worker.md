# Railway Wiki Ingestion Worker

Wiki ingestion runs as a durable background worker. The admin app only enqueues
jobs; the worker claims queued rows from Postgres and writes progress events to
`wiki_ingestion_events`.

## One-time database setup

Run this once against the Railway production database:

```bash
npx tsx scripts/add-wiki-ingestion-jobs.ts
```

## Railway service

Create a second Railway service from the same GitHub repo.

Use the repository root as the service root. In the service settings, set the
config-as-code file path to:

```text
/railway.wiki-ingest-worker.json
```

That file sets the worker start command:

```bash
npm run worker:wiki-ingest
```

## Required variables

Set these on the worker service:

```text
DATABASE_URL
ANTHROPIC_API_KEY
OPENAI_API_KEY
WIKI_INGEST_WORKER_ID=railway-wiki-ingest-1
WIKI_INGEST_POLL_MS=2000
WIKI_INGEST_WRITER_CONCURRENCY=3
```

Use the same `DATABASE_URL` as the admin app. If the database is a Railway
Postgres service in the same project, reference that service's database URL.

## Scaling

Start with one replica. The queue claim uses Postgres row locking, so multiple
workers can run later, but a single worker is easier to observe first.

Scale up when queued runs regularly wait longer than a few minutes.

Within a single run, `WIKI_INGEST_WRITER_CONCURRENCY` controls how many page
writer LLM calls run at once. Start at `3`; lower it if provider rate limits
show up, raise it cautiously after observing stable runs.

## Verification

After deploy:

1. Open the worker service logs and confirm it prints `started workerId=...`.
2. Start an ingestion from `/wikis/:id/ingestion`.
3. Reload the page while it is running.
4. Confirm the UI resumes from the same run.
5. Confirm the run finishes as `succeeded` or `failed` in recent runs.
