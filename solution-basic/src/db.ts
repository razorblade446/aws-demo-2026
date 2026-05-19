import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from './config';

let pool: Pool;

function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      connectionLimit: 5,
    });
  }
  return pool;
}

export interface Task {
  id: number;
  date_created: Date;
  metadata: Record<string, unknown>;
}

export async function fetchPendingTasks(): Promise<Task[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT id, date_created, metadata FROM tasks WHERE date_processed IS NULL ORDER BY date_created LIMIT 100',
  );
  return rows as Task[];
}

export async function markTaskProcessed(id: number): Promise<void> {
  await getPool().query('UPDATE tasks SET date_processed = NOW() WHERE id = ?', [id]);
}
