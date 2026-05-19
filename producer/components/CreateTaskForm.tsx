'use client';

import { useState } from 'react';
import {
  Button,
  TextField,
  Paper,
  Typography,
  Stack,
  CircularProgress,
} from '@mui/material';
import { Task } from '@/lib/types';

interface Props {
  onCreated: (task: Task) => void;
}

export default function CreateTaskForm({ onCreated }: Props) {
  const [company, setCompany] = useState('');
  const [itemCount, setItemCount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            company: company.trim(),
            itemCount: itemCount ? Number(itemCount) : undefined,
            notes: notes.trim() || undefined,
          },
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const task: Task = await res.json();
      onCreated(task);

      setCompany('');
      setItemCount('');
      setNotes('');
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper className="p-6" elevation={1}>
      <Typography variant="h6" className="mb-4 font-semibold">
        Create Shipping Task (Basic Polling)
      </Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={3}>
          <TextField
            label="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
            size="small"
            fullWidth
          />
          <TextField
            label="Item Count"
            type="number"
            value={itemCount}
            onChange={(e) => setItemCount(e.target.value)}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={2}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !company.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {loading ? 'Creating…' : 'Create Task'}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
