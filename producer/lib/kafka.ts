import { Kafka, Producer } from 'kafkajs';

process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';

const kafka = new Kafka({
  clientId: 'producer-app',
  brokers: [(process.env.KAFKA_BROKER ?? 'localhost:9092')],
});

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = kafka.producer();
    await producer.connect();
  }
  return producer;
}

export async function publishToTopic(topic: string, message: unknown): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic,
    messages: [{ value: JSON.stringify(message) }],
  });
}
