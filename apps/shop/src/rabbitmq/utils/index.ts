import {
  RABBITMQ_DEFAULT_PROTOCOL,
  RABBITMQ_DEFAULT_PROTOCOL_LABEL,
  RABBITMQ_SECURE_PORT,
  RABBITMQ_SECURE_PROTOCOL,
  RABBITMQ_SECURE_PROTOCOL_LABEL,
} from '../constants';

interface RabbitMqConnectionParams {
  host?: string;
  port?: number;
}

interface RabbitMqConnectionTransport {
  logLabel: string;
  protocol: string;
  socketOptions?: {
    servername: string;
  };
}

export function resolveConnectionTransport({
  host,
  port,
}: RabbitMqConnectionParams): RabbitMqConnectionTransport {
  if (port === RABBITMQ_SECURE_PORT) {
    return {
      logLabel: RABBITMQ_SECURE_PROTOCOL_LABEL,
      protocol: RABBITMQ_SECURE_PROTOCOL,
      socketOptions: host ? { servername: host } : undefined,
    };
  }

  return {
    logLabel: RABBITMQ_DEFAULT_PROTOCOL_LABEL,
    protocol: RABBITMQ_DEFAULT_PROTOCOL,
  };
}
