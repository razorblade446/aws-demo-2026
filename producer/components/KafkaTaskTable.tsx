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
import { KafkaTask } from '@/lib/types';
import { SHIPPERS, PRODUCTS } from '@/lib/constants';

interface Props {
  tasks: KafkaTask[];
}

const shipperLabel = (v: string) => SHIPPERS.find((s) => s.value === v)?.label ?? v;
const productLabel = (v: string) => PRODUCTS.find((p) => p.value === v)?.label ?? v;

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' });
}

function StatusChip({ task }: { task: KafkaTask }) {
  if (task.date_processed) return <Chip label="Processed" color="success" size="small" />;
  if (task.status === 'sent') return <Chip label="Sent" color="info" size="small" />;
  return <Chip label="Pending" color="default" size="small" />;
}

export default function KafkaTaskTable({ tasks }: Props) {
  return (
    <TableContainer component={Paper} elevation={1}>
      <Typography variant="h6" className="p-4 pb-0 font-semibold">
        Kafka Tasks
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Shipper</TableCell>
            <TableCell>Product</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Processed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} align="center" className="text-gray-400 py-8">
                No tasks yet — create one above.
              </TableCell>
            </TableRow>
          )}
          {tasks.map((task) => (
            <TableRow
              key={task.id}
              className={task.date_processed ? 'bg-green-50' : task.status === 'sent' ? 'bg-blue-50' : ''}
            >
              <TableCell>{task.id}</TableCell>
              <TableCell>
                <Chip label={shipperLabel(task.shipper)} size="small" variant="outlined" />
              </TableCell>
              <TableCell>{productLabel(task.product)}</TableCell>
              <TableCell align="right">{task.qty}</TableCell>
              <TableCell>
                <StatusChip task={task} />
              </TableCell>
              <TableCell>{formatDate(task.date_created)}</TableCell>
              <TableCell>{formatDate(task.date_processed)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
