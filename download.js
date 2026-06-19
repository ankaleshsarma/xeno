import { withClient } from './db.js';

function csvResponse(filename, content) {
  return new Response(content, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store'
    }
  });
}

function errorResponse(statusCode, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export default async function handler(request) {
  if (request.method !== 'GET') {
    return errorResponse(405, 'Method not allowed');
  }

  const url = new URL(request.url);
  const jobId = Number(url.searchParams.get('jobId'));
  const chunk = Number(url.searchParams.get('chunk') || '1');

  if (!Number.isInteger(jobId) || jobId <= 0) {
    return errorResponse(400, 'Valid jobId is required');
  }

  if (!Number.isInteger(chunk) || chunk <= 0) {
    return errorResponse(400, 'Valid chunk number is required');
  }

  try {
    return await withClient(async (client) => {
      const chunkResult = await client.query(
        `select c.chunk_number, c.row_count, c.csv_content, j.filename, j.chunk_count
         from etl_output_chunks c
         join etl_jobs j on j.id = c.job_id
         where c.job_id = $1 and c.chunk_number = $2`,
        [jobId, chunk]
      );

      if (!chunkResult.rows.length) {
        return errorResponse(404, 'Output chunk not found');
      }

      const row = chunkResult.rows[0];
      const baseName = String(row.filename || 'upload.csv').replace(/\.csv$/i, '');
      const filename =
        row.chunk_count > 1
          ? `${baseName}-cleaned-part-${row.chunk_number}.csv`
          : `${baseName}-cleaned.csv`;

      return csvResponse(filename, row.csv_content);
    });
  } catch (error) {
    return errorResponse(500, error instanceof Error ? error.message : 'Unknown server error');
  }
}
