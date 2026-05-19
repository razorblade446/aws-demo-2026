import { config } from './config';
import { processPendingTasks } from './processor';

async function main(): Promise<void> {
  console.log(`Processor started — poll interval ${config.pollIntervalMs}ms`);
  while (true) {
    try {
      await processPendingTasks();
    } catch (err) {
      console.error('Poll error:', err);
    }
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
