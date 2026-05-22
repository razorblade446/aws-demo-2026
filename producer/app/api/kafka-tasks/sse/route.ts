import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

const SELECT_COLS = 'id, date_created, date_processed, shipper, product, qty, status';

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let intervalId: ReturnType<typeof setInterval>;

  const knownSentIds = new Set<number>();
  const knownProcessedIds = new Set<number>();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const [sent] = await pool.query<RowDataPacket[]>(
          "SELECT id FROM kafka_tasks WHERE status = 'sent'"
        );
        for (const row of sent) knownSentIds.add(row.id);

        const [processed] = await pool.query<RowDataPacket[]>(
          'SELECT id FROM kafka_tasks WHERE date_processed IS NOT NULL'
        );
        for (const row of processed) knownProcessedIds.add(row.id);
      } catch {
        // DB not yet available; will catch up on first poll.
      }

      send('connected', { ok: true });

      intervalId = setInterval(async () => {
        if (closed) return;
        try {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT ${SELECT_COLS} FROM kafka_tasks WHERE status = 'sent' OR date_processed IS NOT NULL`
          );

          for (const task of rows) {
            if (task.status === 'sent' && !knownSentIds.has(task.id)) {
              knownSentIds.add(task.id);
              send('task_sent', task);
            }
            if (task.date_processed !== null && !knownProcessedIds.has(task.id)) {
              knownProcessedIds.add(task.id);
              send('task_processed', task);
            }
          }
        } catch (err) {
          console.error('SSE poll error:', err);
        }
      }, 2000);
    },
    cancel() {
      closed = true;
      clearInterval(intervalId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
