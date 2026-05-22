'use client';

import { useEffect, useState, useCallback } from 'react';
import { Snackbar, Alert, Container, Box } from '@mui/material';
import CreateKafkaTaskForm from './CreateKafkaTaskForm';
import KafkaTaskTable from './KafkaTaskTable';
import { KafkaTask } from '@/lib/types';

interface Props {
  initialTasks: KafkaTask[];
}

export default function KafkaTaskDashboard({ initialTasks }: Props) {
  const [tasks, setTasks] = useState<KafkaTask[]>(initialTasks);
  const [notification, setNotification] = useState<string | null>(null);

  const upsertTasks = useCallback((updated: KafkaTask[]) => {
    setTasks((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of updated) map.set(t.id, t);
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime()
      );
    });
  }, []);

  useEffect(() => {
    fetch('/api/kafka-tasks')
      .then((r) => r.json())
      .then((data: KafkaTask[]) => setTasks(data))
      .catch((err) => console.error('[KafkaTaskDashboard] failed to load tasks:', err));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/kafka-tasks/sse');

    es.addEventListener('task_sent', (e) => {
      const task: KafkaTask = JSON.parse(e.data);
      upsertTasks([task]);
    });

    es.addEventListener('task_processed', (e) => {
      const task: KafkaTask = JSON.parse(e.data);
      upsertTasks([task]);
      setNotification(`Task #${task.id} (${task.shipper}) was processed by Lambda`);
    });

    es.onerror = () => {
      // Browser will auto-reconnect on error.
    };

    return () => es.close();
  }, [upsertTasks]);

  return (
    <Container maxWidth="lg" className="py-8">
      <Box className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">Kafka Task Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">
          Tasks are published to the <code>documents-bol</code> Kafka topic and processed by AWS Lambda in real time.
        </p>
      </Box>

      <Box className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Box className="md:col-span-1">
          <CreateKafkaTaskForm onCreated={upsertTasks} />
        </Box>
        <Box className="md:col-span-2">
          <KafkaTaskTable tasks={tasks} />
        </Box>
      </Box>

      <Snackbar
        open={notification !== null}
        autoHideDuration={4000}
        onClose={() => setNotification(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="info" onClose={() => setNotification(null)}>
          {notification}
        </Alert>
      </Snackbar>
    </Container>
  );
}
