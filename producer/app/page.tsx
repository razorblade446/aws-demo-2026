import { RowDataPacket } from 'mysql2';
import pool from '@/lib/db';
import { Task } from '@/lib/types';
import TaskDashboard from '@/components/TaskDashboard';

export const dynamic = 'force-dynamic';

async function getTasks(): Promise<Task[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, date_created, date_processed, metadata FROM tasks ORDER BY date_created DESC LIMIT 100'
    );
    return rows as Task[];
  } catch (err) {
    console.error('[getTasks] DB query failed:', err);
    return [];
  }
}

export default async function Home() {
  const tasks = await getTasks();
  return <TaskDashboard initialTasks={tasks} />;
}
