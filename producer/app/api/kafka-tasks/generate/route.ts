import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { publishToTopic } from '@/lib/kafka';
import { SHIPPERS, PRODUCTS } from '@/lib/constants';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const SELECT_COLS = 'id, date_created, date_processed, shipper, product, qty, status';

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const count = Math.min(Math.max(1, Number(body.count) || 1), 100);

  const rows = Array.from({ length: count }, () => ({
    shipper: randomItem(SHIPPERS).value,
    product: randomItem(PRODUCTS).value,
    qty: Math.floor(Math.random() * 99) + 1,
  }));

  // Bulk insert — MySQL returns the first auto-increment ID; subsequent IDs are contiguous
  const placeholders = rows.map(() => "(?, ?, ?, 'pending')").join(', ');
  const params = rows.flatMap((r) => [r.shipper, r.product, r.qty]);
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO kafka_tasks (shipper, product, qty, status) VALUES ${placeholders}`,
    params
  );

  const firstId = result.insertId;
  const ids = Array.from({ length: count }, (_, i) => firstId + i);
  const idPlaceholders = ids.map(() => '?').join(', ');

  const [inserted] = await pool.query<RowDataPacket[]>(
    `SELECT ${SELECT_COLS} FROM kafka_tasks WHERE id IN (${idPlaceholders}) ORDER BY id DESC`,
    ids
  );

  // Publish all tasks after returning the response
  after(async () => {
    for (const task of inserted) {
      try {
        await publishToTopic('documents-bol', {
          taskId: task.id,
          shipper: task.shipper,
          product: task.product,
          qty: task.qty,
        });
        await pool.execute("UPDATE kafka_tasks SET status = 'sent' WHERE id = ?", [task.id]);
      } catch (err) {
        console.error('[kafka-tasks/generate] publish failed for task', task.id, err);
      }
    }
  });

  return NextResponse.json(inserted, { status: 201 });
}
