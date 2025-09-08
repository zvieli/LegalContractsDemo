# Real Data Ingestion (NDA & Rent)

This folder contains scaffolding to ingest, normalize, validate and version real-world dispute / contract event data for both NDA breaches and Rent disputes.

## Pipelines

1. Raw acquisition into `raw/<domain>/<source>/...`
2. Normalization via `scripts/data/normalizer.js` to `processed/<domain>/dataset.jsonl`
3. Validation against JSON Schemas (`schemas/*.schema.json`)
4. Manifest creation with Merkle root (`scripts/data/manifest.js`) (future)
5. Optional publish to IPFS (future)

## Domains

* NDA (confidentiality breach, IP leakage, early leak severity, misappropriation)
* Rent (damage, condition at start/end, quality & habitability, early termination justification, deposit splits, external valuation references)

## Provenance Fields

Each record must include: `id, domain, source, jurisdiction, retrievedAt, synthetic, classification, rationale, labels[], claimedWei, awardedWei, severity, evidenceURIs[]`

## Commands (after you add data)

```
node scripts/data/validate.js processed/nda/dataset.jsonl schemas/nda.schema.json
node scripts/data/validate.js processed/rent/dataset.jsonl schemas/rent.schema.json
```

## Next Steps

* Add real raw documents under `raw/nda/courtlistener/` and `raw/rent/tribunal/`
* Implement CourtListener API fetch (see placeholder script)
* Replace synthetic placeholder rationale/classifications with model or manual annotations
