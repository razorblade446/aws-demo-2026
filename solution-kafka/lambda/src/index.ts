import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import mysql from 'mysql2/promise';

interface KafkaRecord {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string; // Base64-encoded JSON
}

interface KafkaTriggerEvent {
  records: Record<string, KafkaRecord[]>;
}

const ssm = new SSMClient({ region: process.env.AWS_REGION });

let dbPool: mysql.Pool | null = null;

async function getParam(name: string): Promise<string> {
  const res = await ssm.send(new GetParameterCommand({ Name: name }));
  return res.Parameter?.Value ?? '';
}

async function getPool(): Promise<mysql.Pool> {
  if (dbPool) return dbPool;

  const [user, password] = await Promise.all([
    getParam(process.env.DB_USER_PARAM!),
    getParam(process.env.DB_PASSWORD_PARAM!),
  ]);

  dbPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user,
    password,
    database: process.env.DB_NAME ?? 'producer',
    connectionLimit: 5,
    waitForConnections: true,
  });

  return dbPool;
}

export async function handler(event: KafkaTriggerEvent): Promise<void> {
  const pool = await getPool();

  for (const records of Object.values(event.records)) {
    for (const record of records) {
      const raw = Buffer.from(record.value, 'base64').toString('utf-8');
      const payload = JSON.parse(raw) as { taskId: number; shipper: string; product: string; qty: number };

      console.log(JSON.stringify({
        topic: record.topic,
        partition: record.partition,
        offset: record.offset,
        payload,
      }));

      await pool.execute(
        'UPDATE kafka_tasks SET date_processed = NOW() WHERE id = ?',
        [payload.taskId]
      );
    }
  }
}
