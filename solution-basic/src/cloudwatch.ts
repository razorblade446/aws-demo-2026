import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { config } from './config';

const client = new CloudWatchLogsClient({ region: config.cloudwatch.region });
const logStreamName = `processor-${new Date().toISOString().slice(0, 10)}`;
let streamReady = false;

async function ensureStream(): Promise<void> {
  if (streamReady) return;
  try {
    await client.send(new CreateLogStreamCommand({
      logGroupName: config.cloudwatch.logGroup,
      logStreamName,
    }));
  } catch (err: any) {
    if (err.name !== 'ResourceAlreadyExistsException') throw err;
  }
  streamReady = true;
}

export async function logTask(task: { id: number; date_created: Date; metadata: Record<string, unknown> }): Promise<void> {
  await ensureStream();
  await client.send(new PutLogEventsCommand({
    logGroupName: config.cloudwatch.logGroup,
    logStreamName,
    logEvents: [{
      timestamp: Date.now(),
      message: JSON.stringify({ taskId: task.id, date_created: task.date_created, metadata: task.metadata }),
    }],
  }));
}
