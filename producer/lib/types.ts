export interface Task {
  id: number;
  date_created: string;
  date_processed: string | null;
  metadata: Record<string, unknown>;
}
