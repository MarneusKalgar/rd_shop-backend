const rabbitMqContainerDataDir = '/var/lib/rabbitmq';
const rabbitMqContainerName = 'rd-shop-rabbitmq';
const rabbitMqManagementPort = 15672;

interface BuildMessageBrokerUserDataArgs {
  brokerSecretArn: string;
  dataVolumeDeviceName: string;
  dataVolumeId: string;
  dataVolumeMountPath: string;
  image: string;
  port: number;
  region: string;
}

export function buildMessageBrokerUserData({
  brokerSecretArn,
  dataVolumeDeviceName,
  dataVolumeId,
  dataVolumeMountPath,
  image,
  port,
  region,
}: BuildMessageBrokerUserDataArgs) {
  return `#!/bin/bash
set -euxo pipefail

dnf install -y awscli docker jq
systemctl enable --now docker

resolved_device=''

for attempt in {1..60}; do
  if [[ -b '${dataVolumeDeviceName}' ]]; then
    resolved_device='${dataVolumeDeviceName}'
    break
  fi

  device_by_id=$(find /dev/disk/by-id -maxdepth 1 -type l -name '*${dataVolumeId}' | head -n 1 || true)
  if [[ -n "$device_by_id" ]]; then
    resolved_device=$(readlink -f "$device_by_id")
    break
  fi

  sleep 2
done

if [[ -z "$resolved_device" ]]; then
  echo 'RabbitMQ data volume device not found' >&2
  exit 1
fi

if ! blkid "$resolved_device" >/dev/null 2>&1; then
  mkfs -t ext4 "$resolved_device"
fi

mkdir -p '${dataVolumeMountPath}'

filesystem_uuid=$(blkid -s UUID -o value "$resolved_device")
fstab_entry="UUID=$filesystem_uuid ${dataVolumeMountPath} ext4 defaults,nofail 0 2"

if ! grep -q "$filesystem_uuid" /etc/fstab; then
  echo "$fstab_entry" >> /etc/fstab
fi

mount -a
chown -R 999:999 '${dataVolumeMountPath}'

mkdir -p /etc/rd-shop
aws secretsmanager get-secret-value \
  --region '${region}' \
  --secret-id '${brokerSecretArn}' \
  --query SecretString \
  --output text > /etc/rd-shop/rabbitmq-bootstrap.json

RABBITMQ_DEFAULT_USER=$(jq -r '.RABBITMQ_DEFAULT_USER' /etc/rd-shop/rabbitmq-bootstrap.json)
RABBITMQ_DEFAULT_PASS=$(jq -r '.RABBITMQ_DEFAULT_PASS' /etc/rd-shop/rabbitmq-bootstrap.json)
RABBITMQ_DEFAULT_VHOST=$(jq -r '.RABBITMQ_DEFAULT_VHOST' /etc/rd-shop/rabbitmq-bootstrap.json)

docker rm -f '${rabbitMqContainerName}' || true
docker run -d \
  --name '${rabbitMqContainerName}' \
  --restart unless-stopped \
  -p ${port}:5672 \
  -p ${rabbitMqManagementPort}:15672 \
  -e RABBITMQ_DEFAULT_USER="$RABBITMQ_DEFAULT_USER" \
  -e RABBITMQ_DEFAULT_PASS="$RABBITMQ_DEFAULT_PASS" \
  -e RABBITMQ_DEFAULT_VHOST="$RABBITMQ_DEFAULT_VHOST" \
  -v '${dataVolumeMountPath}:${rabbitMqContainerDataDir}' \
  '${image}'

for attempt in {1..60}; do
  if docker exec '${rabbitMqContainerName}' rabbitmq-diagnostics ping; then
    exit 0
  fi

  sleep 5
done

docker logs '${rabbitMqContainerName}' || true
exit 1
`;
}
