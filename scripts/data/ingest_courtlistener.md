## CourtListener Ingestion

API docs: https://www.courtlistener.com/api/

### Auth
Create an account, generate an API token, then export it:

PowerShell:
```
$env:COURTLISTENER_TOKEN="<your_token_here>"
```

The fetch script automatically adds `Authorization: Token <token>` if the env var is set.

### Fetch NDA breach related opinions
```
node scripts/data/fetch_courtlistener_nda.js "non-disclosure agreement breach" 80 > data/raw/nda/courtlistener.jsonl
```
Arguments:
1. search phrase (spaces ok)
2. optional limit (default 50)

Environment (optional):
- COURTLISTENER_TOKEN        API token (recommended, avoids anonymous limits)
- COURTLISTENER_BASE         Override base URL (default prod)
- COURTLISTENER_DELAY_MS     Delay between page requests (default 600ms)

Output: NDJSON of raw CourtListener opinion objects.

### Normalize (implement your normalizer to map into internal NDA schema)
Example outline (pseudo):
```
# cat data/raw/nda/courtlistener.jsonl | node scripts/data/normalizer.js > data/processed/nda_normalized.jsonl
```

### Label
```
node scripts/data/label_gemini.js data/processed/nda_normalized.jsonl NDA > data/processed/nda_labeled.jsonl
```

### Stats & Sample
```
node scripts/data/stats.js data/processed/nda_labeled.jsonl
node scripts/data/sample.js data/processed/nda_labeled.jsonl 3
```

Then you can run evaluation against the AI endpoint using that file as input.
