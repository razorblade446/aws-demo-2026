import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { publishToTopic } from '@/lib/kafka';
import { SHIPPER_VALUES, PRODUCT_VALUES } from '@/lib/constants';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const SELECT_COLS = 'id, date_created, date_processed, shipper, product, qty, status';

export async function GET() {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SELECT_COLS} FROM kafka_tasks ORDER BY date_created DESC LIMIT 100`
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shipper, product, qty } = body as { shipper: string; product: string; qty: unknown };

  if (!SHIPPER_VALUES.includes(shipper)) {
    return NextResponse.json({ error: 'Invalid shipper' }, { status: 400 });
  }
  if (!PRODUCT_VALUES.includes(product)) {
    return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
  }
  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum < 1) {
    return NextResponse.json({ error: 'qty must be a positive integer' }, { status: 400 });
  }

  // Phase 1: insert with status='pending'
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO kafka_tasks (shipper, product, qty, status) VALUES (?, ?, ?, 'pending')",
    [shipper, product, qtyNum]
  );
  const taskId = result.insertId;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SELECT_COLS} FROM kafka_tasks WHERE id = ?`,
    [taskId]
  );
  const task = rows[0];

  // Phase 2: publish after response, then mark 'sent'
  after(async () => {
    try {
      await publishToTopic('documents-bol', { taskId, shipper, product, qty: qtyNum });
      await pool.execute("UPDATE kafka_tasks SET status = 'sent' WHERE id = ?", [taskId]);
    } catch (err) {
      console.error('[kafka-tasks] publish failed for task', taskId, err);
    }
  });

  return NextResponse.json(task, { status: 201 });
}
