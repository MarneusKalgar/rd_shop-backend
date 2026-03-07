import { config } from 'dotenv';
import * as fs from 'fs';
import { Client } from 'pg';

config({ path: `.env.${process.env.NODE_ENV}` });

interface PgClient {
  connect();
  end();
  query(sql: string): Promise<SQLResult>;
}

interface SQLResult {
  rowCount: number;
}

async function runSqlFile(filePath: string) {
  const client: PgClient = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Neon uses SSL
    },
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected');

    console.log(`📄 Reading SQL file: ${filePath}`);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log('🚀 Executing SQL...');
    const startTime = Date.now();
    const result: SQLResult = await client.query(sql);
    const endTime = Date.now();

    console.log('✅ SQL executed successfully');
    console.log(`⏱️  Execution time: ${endTime - startTime}ms`);
    console.log(`📊 Rows affected: ${result.rowCount ?? 0}`);

    return result;
  } catch (error) {
    console.error('❌ Error executing SQL:', error);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed');
  }
}

const filePath = process.argv[2];
runSqlFile(filePath).catch((error) => {
  console.error('❌ Error running SQL file:', error);
  process.exit(1);
});
