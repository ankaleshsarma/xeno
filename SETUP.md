# Setup Guide

## Architecture Summary

This project follows a **minimal backend, heavy database** pattern:

- **Frontend** (index.html): User interface, all UI logic, hosted on Vercel static
- **Backend** (api/process.js, api/download.js): Thin orchestration layer on Vercel serverless
- **Database** (Supabase Postgres): All validation, all data processing, all output generation

**Load distribution:**
- CSV parsing: Backend (Node.js)
- Validation: Database (SQL procedures)
- Chunking: Database (SQL procedures)
- Download: Backend (simple fetch + stream)

## Step-by-Step Supabase Setup

### 1. Create Supabase Project
- Go to [supabase.com](https://supabase.com)
- Click "New project"
- Choose organization, project name, region
- Wait for project to be created (~1-2 min)

### 2. Get Connection String
- Click "Project Settings" (bottom-left)
- Click "Database"
- Find "Connection pooler" tab
- Copy the connection string (looks like: `postgresql://postgres:[password]@[host]:6543/postgres`)
- Port must be **6543** (not 5432)

### 3. Run SQL Schema
- In your new project, click "SQL Editor" (left sidebar)
- Click "New query"
- Copy the entire contents of `sql/init.sql` from this repository
- Paste it into the editor
- Click "Run"
- Wait for success (creates tables + functions in ~5 seconds)

You should see these messages:
```
CREATE TABLE
CREATE TABLE
CREATE TABLE
...
CREATE FUNCTION
CREATE FUNCTION
...
```

**That's it for Supabase!** Schema is complete, all functions deployed.

## Step-by-Step Vercel Setup

### 1. Connect Repository
- Go to [vercel.com](https://vercel.com)
- Click "New Project"
- Connect your GitHub account
- Select this repository
- Click "Import"

### 2. Set Environment Variables
- On the "Configure Project" page, click "Environment Variables"
- Add new variable:
  - Name: `DATABASE_URL`
  - Value: (paste the Supabase connection pooler string from step 2 above)
- Click "Deploy"

Vercel will automatically:
- Deploy `index.html` as static frontend
- Deploy `api/process.js` and `api/download.js` as serverless functions
- Set `DATABASE_URL` in function environment

### 3. Test Deployment
- Open the Vercel deployment URL (e.g., `https://myproject.vercel.app`)
- Upload a test CSV
- Should see validation results

## Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Create .env.local
```bash
cp .env.local.example .env.local
# Then edit .env.local with your Supabase connection string
```

Example `.env.local`:
```
DATABASE_URL=postgresql://postgres:your_password@your_host.supabase.co:6543/postgres
```

### 3. Run Dev Server
```bash
npm run dev
```

Open `http://localhost:3000` in browser

## Testing

### Minimal Test CSV
Save as `test.csv`:
```csv
order_id,product_id,phone,date,payment_mode,country_code
1,ABC,9876543210,2024-01-15,credit_card,SG
2,DEF,123456,2024-01-16,debit_card,US
3,GHI,9876543210,invalid_date,credit_card,SG
```

### Upload Steps
1. Open app
2. Set chunk size to 10 (small for testing)
3. Verify required fields: `order_id,product_id,phone,date,payment_mode`
4. Set phone rules:
   ```json
   {"SG": 10, "US": 10}
   ```
5. Upload test.csv
6. Should see:
   - Row 2 has phone length mismatch (6 digits for US)
   - Row 3 has invalid date
   - Row 1 passes all validations
7. Download cleaned CSV (only row 1)

## File Structure

```
.
├── index.html              # Frontend UI
├── api/
│   ├── process.js          # POST handler - parse CSV, call SQL validation
│   ├── download.js         # GET handler - serve CSV chunks
│   └── db.js               # Database connection helper
├── sql/
│   └── init.sql            # Schema + SQL functions (run once in Supabase)
├── package.json            # Dependencies
├── README.md               # Main documentation
└── .env.local.example      # Template for local env vars
```

## Troubleshooting

### `DATABASE_URL not set`
- Make sure `.env.local` exists and has correct connection string
- For Vercel, check Project Settings → Environment Variables

### `Connection refused on port 5432`
- Make sure you're using **port 6543** (connection pooler, not direct)
- Check `DATABASE_URL` string starts with `postgresql://`

### `Table not found: etl_jobs`
- SQL schema wasn't run, go back to Supabase SQL Editor and run `sql/init.sql`

### `Validation not running`
- Check that `run_etl_job()` function exists in Supabase SQL Editor
- Verify phone_rules are inserted correctly

### `Download gives 404`
- Job ID might be wrong
- Make sure validation completed (check logs in response)

## Performance Notes

- **Validation speed**: Limited by Postgres transaction time, typically <1s for 10k rows
- **Chunk generation**: Built in SQL, very fast (builds CSV in memory)
- **Download**: Streams CSV from `etl_output_chunks` table
- **Large files**: Split into chunks automatically (configurable chunk size)

## Security Notes

- No authentication on `/api/process` and `/api/download` (add if needed)
- Database connection uses SSL by default (Supabase)
- All validation runs in Postgres (no code injection from CSV)
- Phone rules and date formats configurable per upload (no hardcoding)
