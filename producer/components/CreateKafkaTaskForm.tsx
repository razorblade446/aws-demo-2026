'use client';

import { useState } from 'react';
import {
  Button,
  TextField,
  Paper,
  Typography,
  Stack,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Divider,
} from '@mui/material';
import { KafkaTask } from '@/lib/types';
import { SHIPPERS, PRODUCTS } from '@/lib/constants';

interface Props {
  onCreated: (tasks: KafkaTask[]) => void;
}

export default function CreateKafkaTaskForm({ onCreated }: Props) {
  const [shipper, setShipper] = useState('');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<10 | 100 | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipper || !product) return;

    setLoading(true);
    try {
      const res = await fetch('/api/kafka-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipper, product, qty: Number(qty) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const task: KafkaTask = await res.json();
      onCreated([task]);
      setShipper('');
      setProduct('');
      setQty('1');
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (count: 10 | 100) => {
    setGenerating(count);
    try {
      const res = await fetch('/api/kafka-tasks/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tasks: KafkaTask[] = await res.json();
      onCreated(tasks);
    } catch (err) {
      console.error('Failed to generate tasks:', err);
    } finally {
      setGenerating(null);
    }
  };

  return (
    <Paper className="p-6" elevation={1}>
      <Typography variant="h6" className="mb-4 font-semibold">
        Create Shipping Task
      </Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={3}>
          <FormControl size="small" fullWidth required>
            <InputLabel id="shipper-label">Shipping Company</InputLabel>
            <Select
              labelId="shipper-label"
              value={shipper}
              label="Shipping Company"
              onChange={(e) => setShipper(e.target.value)}
            >
              {SHIPPERS.map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth required>
            <InputLabel id="product-label">Product</InputLabel>
            <Select
              labelId="product-label"
              value={product}
              label="Product"
              onChange={(e) => setProduct(e.target.value)}
            >
              {PRODUCTS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Quantity"
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            size="small"
            fullWidth
            required
            slotProps={{ htmlInput: { min: 1 } }}
          />

          <Button
            type="submit"
            variant="contained"
            disabled={loading || !shipper || !product}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {loading ? 'Creating…' : 'Create Task'}
          </Button>
        </Stack>
      </form>

      <Divider className="my-4" />

      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Bulk generation
        </Typography>
        <Button
          variant="outlined"
          size="small"
          disabled={generating !== null}
          startIcon={generating === 10 ? <CircularProgress size={14} /> : null}
          onClick={() => handleGenerate(10)}
        >
          {generating === 10 ? 'Generating…' : 'Generate 10 Tasks'}
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={generating !== null}
          startIcon={generating === 100 ? <CircularProgress size={14} /> : null}
          onClick={() => handleGenerate(100)}
        >
          {generating === 100 ? 'Generating…' : 'Generate 100 Tasks'}
        </Button>
      </Stack>
    </Paper>
  );
}
