'use client';

import { useEffect, useState, useCallback } from 'react';
import { Snackbar, Alert, Container, Box } from '@mui/material';
import CreateTaskForm from './CreateTaskForm';
import TaskTable from './TaskTable';
import { Task } from '@/lib/types';

interface Props {
  initialTasks: Task[];
}

export default function TaskDashboard({ initialTasks }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notification, setNotification] = useState<string | null>(null);

  const upsertTask = useCallback((updated: Task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, []);

  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((data: Task[]) => setTasks(data))
      .catch((err) => console.error('[TaskDashboard] failed to load tasks:', err));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/tasks/sse');

    es.addEventListener('task_processed', (e) => {
      const task: Task = JSON.parse(e.data);
      upsertTask(task);
      const company =
        typeof task.metadata?.company === 'string'
          ? task.metadata.company
          : `#${task.id}`;
      setNotification(`Task for ${company} was processed`);
    });

    es.onerror = () => {
      // Browser will auto-reconnect on error; no action needed.
    };

    return () => es.close();
  }, [upsertTask]);

  return (
    <Container maxWidth="lg" className="py-8">
      <Box className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Shipping Task Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Create tasks and watch them get processed in real time.
        </p>
      </Box>

      <Box className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Box className="md:col-span-1">
          <CreateTaskForm onCreated={upsertTask} />
        </Box>
        <Box className="md:col-span-2">
          <TaskTable tasks={tasks} />
        </Box>
      </Box>

      <Snackbar
        open={notification !== null}
        autoHideDuration={4000}
        onClose={() => setNotification(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" onClose={() => setNotification(null)}>
          {notification}
        </Alert>
      </Snackbar>
    </Container>
  );
}
