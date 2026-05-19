import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET() {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, date_created, date_processed, metadata FROM tasks ORDER BY date_created DESC LIMIT 100'
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const metadata: Record<string, unknown> = body.metadata ?? {};

  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO tasks (date_created, metadata) VALUES (NOW(), ?)',
    [JSON.stringify(metadata)]
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, date_created, date_processed, metadata FROM tasks WHERE id = ?',
    [result.insertId]
  );

  return NextResponse.json(rows[0], { status: 201 });
}
