import dotenv from 'dotenv';

dotenv.config();

export const config = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'producer',
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000'),
  cloudwatch: {
    logGroup: process.env.CW_LOG_GROUP || '/solution-basic/tasks',
    region: process.env.AWS_REGION || 'us-east-1',
  },
};
