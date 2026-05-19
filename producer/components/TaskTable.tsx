'use client';

import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  Chip,
  Typography,
} from '@mui/material';
import { Task } from '@/lib/types';

interface Props {
  tasks: Task[];
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' });
}

function formatMetadata(value: unknown): string {
  const obj = typeof value === 'string' ? JSON.parse(value) : value;
  return JSON.stringify(obj, null, 0);
}

export default function TaskTable({ tasks }: Props) {
  return (
    <TableContainer component={Paper} elevation={1}>
      <Typography variant="h6" className="p-4 pb-0 font-semibold">
        Tasks
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Processed</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Metadata</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} align="center" className="text-gray-400 py-8">
                No tasks yet — create one above.
              </TableCell>
            </TableRow>
          )}
          {tasks.map((task) => (
            <TableRow
              key={task.id}
              className={task.date_processed ? 'bg-green-50' : ''}
            >
              <TableCell>{task.id}</TableCell>
              <TableCell>{formatDate(task.date_created)}</TableCell>
              <TableCell>{formatDate(task.date_processed)}</TableCell>
              <TableCell>
                {task.date_processed ? (
                  <Chip label="Processed" color="success" size="small" />
                ) : (
                  <Chip label="Pending" color="default" size="small" />
                )}
              </TableCell>
              <TableCell>
                <code className="text-xs text-gray-600 whitespace-pre-wrap break-all">
                  {formatMetadata(task.metadata)}
                </code>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
