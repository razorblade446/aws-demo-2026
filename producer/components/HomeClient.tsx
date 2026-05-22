'use client';

import { useState } from 'react';
import { Tabs, Tab, Box } from '@mui/material';
import TaskDashboard from './TaskDashboard';
import KafkaTaskDashboard from './KafkaTaskDashboard';
import { Task, KafkaTask } from '@/lib/types';

interface Props {
  initialTasks: Task[];
  initialKafkaTasks: KafkaTask[];
}

export default function HomeClient({ initialTasks, initialKafkaTasks }: Props) {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, pt: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          {false && <Tab label="Basic Polling" />}
          <Tab label="Kafka" />
        </Tabs>
      </Box>
      {false && <TaskDashboard initialTasks={initialTasks} />}
      {tab === 0 && <KafkaTaskDashboard initialTasks={initialKafkaTasks} />}
    </Box>
  );
}
