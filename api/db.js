import pg from 'pg';

const { Client } = pg;

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function createClient() {
  return new Client({
    connectionString: requireEnv('DATABASE_URL'),
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: false }
  });
}

export async function withClient(fn) {
  const client = createClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
