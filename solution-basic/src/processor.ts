import { fetchPendingTasks, markTaskProcessed } from './db';
import { logTask } from './cloudwatch';

export async function processPendingTasks(): Promise<void> {
  const tasks = await fetchPendingTasks();
  for (const task of tasks) {
    await logTask(task);
    await markTaskProcessed(task.id);
    console.log(`Processed task ${task.id}`);
  }
}
