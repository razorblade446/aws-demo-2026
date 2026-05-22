export interface Task {
  id: number;
  date_created: string;
  date_processed: string | null;
  metadata: Record<string, unknown>;
}

export interface KafkaTask {
  id: number;
  date_created: string;
  date_processed: string | null;
  shipper: string;
  product: string;
  qty: number;
  status: 'pending' | 'sent';
}
