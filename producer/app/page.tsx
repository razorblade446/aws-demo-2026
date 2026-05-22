import { RowDataPacket } from 'mysql2';
import pool from '@/lib/db';
import { Task, KafkaTask } from '@/lib/types';
import HomeClient from '@/components/HomeClient';

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

async function getKafkaTasks(): Promise<KafkaTask[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, date_created, date_processed, shipper, product, qty, status FROM kafka_tasks ORDER BY date_created DESC LIMIT 100'
    );
    return rows as KafkaTask[];
  } catch (err) {
    console.error('[getKafkaTasks] DB query failed:', err);
    return [];
  }
}

export default async function Home() {
  const [tasks, kafkaTasks] = await Promise.all([getTasks(), getKafkaTasks()]);
  return <HomeClient initialTasks={tasks} initialKafkaTasks={kafkaTasks} />;
}
