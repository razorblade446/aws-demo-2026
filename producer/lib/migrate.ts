import path from 'path';
import { promises as fs } from 'fs';
import { Umzug } from 'umzug';
import pool from './db';
import type { RowDataPacket } from 'mysql2';

const storage = {
  async logMigration({ name }: { name: string }) {
    await pool.execute('INSERT INTO migrations (name) VALUES (?)', [name]);
  },
  async unlogMigration({ name }: { name: string }) {
    await pool.execute('DELETE FROM migrations WHERE name = ?', [name]);
  },
  async executed(): Promise<string[]> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        name   VARCHAR(255) NOT NULL,
        run_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (name)
      )
    `);
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT name FROM migrations ORDER BY name'
    );
    return rows.map((r) => r.name as string);
  },
};

const migrationsDir = path.join(process.cwd(), 'migrations');

const umzug = new Umzug({
  migrations: {
    glob: `${migrationsDir}/*.sql`,
    resolve: ({ name, path: filePath }) => ({
      name,
      up: async () => {
        const sql = await fs.readFile(filePath!, 'utf-8');
        await pool.execute(sql);
      },
    }),
  },
  storage,
  logger: console,
});

export async function runMigrations(): Promise<void> {
  await umzug.up();
}
