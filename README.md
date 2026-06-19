# Transaction ETL Validator

**Minimal Vercel backend** + **heavy Supabase Postgres processing**.

Upload CSV → Stage rows → SQL validates → SQL chunks output → Download cleaned files.

## Architecture

```
Frontend (index.html, Vercel static)
  ↓ FormData(file + config)
  ↓
Vercel API (thin orchestrator)
  ├─ api/process.js: Parse CSV → Stage rows → Call SQL functions → Return metadata
  └─ api/download.js: Fetch CSV chunk from database → Download
  ↓
Supabase Postgres (heavy lifting)
  ├─ Tables: etl_jobs, etl_staging, etl_job_logs, etl_clean_rows, etl_output_chunks
  ├─ run_etl_job(): Validates all rows (required fields, phone, date)
  └─ generate_output_chunks(): Splits valid rows into CSV chunks
```

**Why this design?**
- **Vercel**: Simple CSV parsing + orchestration (no validation logic)
- **Postgres**: All validation + chunking in SQL (faster, scalable, stateful)
- **Frontend**: All UI, state, user interaction (runs on Vercel too, but as static site)

## Quickstart

### 1. Supabase Setup
1. Go to [supabase.com](https://supabase.com) → Create a new project
2. Go to **Project Settings → Database** → Copy **Connection pooler** (port 6543)
3. In **SQL Editor**, paste entire [sql/init.sql](sql/init.sql) and run it
   - Creates all tables and functions
   - No further setup needed

### 2. Vercel Environment
Add environment variable:
- `DATABASE_URL` = your Supabase connection pooler URL

### 3. Local Dev
```bash
npm install
# Create .env.local with:
# DATABASE_URL=postgresql://user:password@host:6543/database
npm run dev
```
Open `http://localhost:3000`

## How it works

1. **Upload** CSV + set chunk size, validation rules
2. **Frontend** sends FormData to `POST /api/process`
3. **Backend** (api/process.js):
   - Parses CSV with csv-parse
   - Normalizes headers (lowercase, underscores)
   - Inserts rows into `etl_staging`
   - Calls Postgres `run_etl_job()` function
   - Calls Postgres `generate_output_chunks()` function
   - Returns job metadata + logs
4. **Frontend** displays:
   - 8 metrics (rows read, valid, invalid, missing, phone issues, date issues, etc.)
   - Validation logs (per-row errors)
   - Download buttons for each chunk
5. **Download** CSV chunk via `GET /api/download?jobId=1&chunk=1`

## API

### POST /api/process
**Request** (multipart/form-data):
```
file: (CSV file)
chunkSize: 10000
requiredFields: order_id,product_id,phone,date,payment_mode
phoneField: phone
dateField: date
countryField: country_code
phoneRules: {"SG": 8, "IN": 10, "US": 10}
dateFormats: YYYY-MM-DD,DD/MM/YYYY,MM/DD/YYYY
```

**Response**:
```json
{
  "ok": true,
  "jobId": 1,
  "job": {
    "rows_read": 100,
    "valid_rows": 95,
    "invalid_rows": 5,
    "missing_rows": 2,
    "phone_issues": 2,
    "date_issues": 1
  },
  "logs": [
    {
      "rowNumber": 3,
      "status": "error",
      "code": "missing_field",
      "fieldName": "phone",
      "message": "Required field is empty"
    }
  ],
  "headers": ["order_id", "product_id", "phone", "date", "payment_mode"],
  "output": {
    "chunkCount": 1,
    "chunks": [
      {"chunkNumber": 1, "rowCount": 95}
    ]
  }
}
```

### GET /api/download
**Query params**:
- `jobId` (required, integer)
- `chunk` (optional, defaults to 1)

**Response**: CSV file with proper `Content-Disposition` header

## Validation Rules (in Postgres)

**Required Fields**: Empty values → `missing_field` error

**Phone**: 
- Extract digits only
- Check country_code against phone_rules
- Log mismatch → `phone_invalid` error

**Date**: 
- Try each allowed format
- No matches → `date_invalid` error

All validation happens in SQL `run_etl_job()` procedure for performance.

## Database Schema

**etl_jobs**: Job metadata (rows read, counts)
**etl_staging**: Raw CSV rows (input)
**etl_job_logs**: Validation errors (per-row)
**etl_clean_rows**: Valid rows (output)
**etl_output_chunks**: CSV chunks (ready for download)
**phone_rules**: Country phone digit rules

## Deployment

1. Deploy to Vercel: Connect GitHub repo
2. Set `DATABASE_URL` env var in Vercel project settings
3. Done! Frontend + API ready to use

No database migrations needed. Supabase schema already created from sql/init.sql.
