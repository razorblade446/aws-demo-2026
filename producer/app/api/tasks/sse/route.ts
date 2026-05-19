import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let intervalId: ReturnType<typeof setInterval>;

  // Track which task IDs were already processed at connection time so we only
  // emit events for tasks that transition to processed during this session.
  const knownProcessedIds = new Set<number>();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Seed known processed IDs so we don't re-notify on connect.
      try {
        const [existing] = await pool.query<RowDataPacket[]>(
          'SELECT id FROM tasks WHERE date_processed IS NOT NULL'
        );
        for (const row of existing) knownProcessedIds.add(row.id);
      } catch {
        // DB not yet available; SSE will still connect and retry on each poll.
      }

      send('connected', { ok: true });

      intervalId = setInterval(async () => {
        if (closed) return;
        try {
          const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT id, date_created, date_processed, metadata FROM tasks WHERE date_processed IS NOT NULL'
          );

          for (const task of rows) {
            if (!knownProcessedIds.has(task.id)) {
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
