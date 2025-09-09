# Flexible Rent Data Ingest

This script (`ingest_rent_flexible.js`) allows you to ingest rent dispute data from various formats (CSV, JSONL, Excel) and convert it to NDJSON for the pipeline.

## Usage

```bash
node scripts/data/ingest_rent_flexible.js <inputFile> > data/raw/rent/converted.jsonl
```
Supported formats: `.csv`, `.jsonl`, `.xlsx`

## Example
- For CSV: columns should include at least `id,disputeType,claimedEth,awardedEth,severity,text`
- For JSONL: each line should be a JSON object with those fields
- For Excel: first sheet, columns as above

## Requirements
- For Excel support, install:
```bash
npm install xlsx
```

## Output
Each line in `converted.jsonl` will be a normalized JSON object ready for the pipeline.
