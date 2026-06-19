import { parse } from 'csv-parse/sync';
import { withClient } from './db.js';

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return json(400, { ok: false, error: 'CSV file is required' });
    }

    // Parse CSV
    const csvText = await file.text();
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    if (!records.length) {
      return json(400, { ok: false, error: 'CSV file is empty' });
    }

    // Normalize records and headers
    const normalizedRecords = records.map((record) => {
      const output = {};
      for (const [key, value] of Object.entries(record)) {
        output[normalizeHeader(key)] = value;
      }
      return output;
    });
    const headers = Object.keys(normalizedRecords[0]).filter(Boolean);

    // Parse config
    const requiredFields = String(formData.get('requiredFields') || 'order_id,product_id,phone,date,payment_mode')
      .split(',')
      .map((f) => normalizeHeader(f.trim()))
      .filter(Boolean);
    
    const phoneField = normalizeHeader(formData.get('phoneField') || 'phone');
    const dateField = normalizeHeader(formData.get('dateField') || 'date');
    const countryField = normalizeHeader(formData.get('countryField') || 'country_code');
    
    const dateFormats = String(formData.get('dateFormats') || 'YYYY-MM-DD,DD/MM/YYYY,MM/DD/YYYY,YYYY/MM/DD,DD-MM-YYYY')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    
    const phoneRules = (() => {
      try {
        return JSON.parse(formData.get('phoneRules') || '{}');
      } catch {
        return {};
      }
    })();
    
    const chunkSize = Math.max(100, Math.floor(Number(formData.get('chunkSize') || 10000)));

    return await withClient(async (client) => {
      // Create job
      const jobRes = await client.query(
        'insert into etl_jobs (filename, rows_read, chunk_size) values ($1, $2, $3) returning id',
        [file.name || 'upload.csv', normalizedRecords.length, chunkSize]
      );
      const jobId = jobRes.rows[0].id;

      // Upsert phone rules
      for (const [code, digits] of Object.entries(phoneRules)) {
        await client.query(
          'insert into phone_rules (country_code, digits) values ($1, $2) on conflict (country_code) do update set digits = $2',
          [String(code).toUpperCase(), Number(digits)]
        );
      }

      // Stage rows
      const stagingPayload = normalizedRecords.map((record, idx) => ({
        row_number: idx + 2,
        row_data: record
      }));
      
      await client.query(
        `insert into etl_staging (job_id, row_number, row_data)
         select $1, s.row_number, s.row_data
         from jsonb_to_recordset($2::jsonb) as s(row_number int, row_data jsonb)`,
        [jobId, JSON.stringify(stagingPayload)]
      );

      // Run validation in Postgres
      await client.query('select run_etl_job($1::bigint, $2::jsonb, $3, $4, $5, $6::jsonb)', [
        jobId,
        JSON.stringify(requiredFields),
        phoneField,
        dateField,
        countryField,
        JSON.stringify(dateFormats)
      ]);

      // Generate chunks in Postgres
      await client.query('select generate_output_chunks($1::bigint, $2::int, $3::jsonb)', [
        jobId,
        chunkSize,
        JSON.stringify(headers)
      ]);

      // Load results
      const jobRes2 = await client.query('select * from etl_jobs where id = $1', [jobId]);
      const job = jobRes2.rows[0];

      const logsRes = await client.query(
        `select row_number as "rowNumber", status, code, field_name as "fieldName", message
         from etl_job_logs where job_id = $1 order by row_number, id`,
        [jobId]
      );

      const previewRes = await client.query(
        'select row_data as data from etl_clean_rows where job_id = $1 order by row_number limit 5',
        [jobId]
      );

      const chunksRes = await client.query(
        'select chunk_number as "chunkNumber", row_count as "rowCount" from etl_output_chunks where job_id = $1 order by chunk_number',
        [jobId]
      );

      return json(200, {
        ok: true,
        jobId,
        job: {
          id: job.id,
          filename: job.filename,
          rows_read: job.rows_read,
          valid_rows: job.valid_rows,
          invalid_rows: job.invalid_rows,
          missing_rows: job.missing_rows,
          phone_issues: job.phone_issues,
          date_issues: job.date_issues,
          chunk_count: job.chunk_count
        },
        logs: logsRes.rows,
        headers,
        preview: previewRes.rows.map((r) => r.data),
        output: {
          chunkSize,
          chunkCount: job.chunk_count,
          chunks: chunksRes.rows
        }
      });
    });
  } catch (error) {
    console.error('Processing error:', error);
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
