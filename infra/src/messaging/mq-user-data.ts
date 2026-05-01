const rabbitMqContainerDataDir = '/var/lib/rabbitmq';
const rabbitMqContainerName = 'rd-shop-rabbitmq';
const rabbitMqManagementPort = 15672;
const rabbitMqBootstrapLogPath = '/var/log/rd-shop-rabbitmq-bootstrap.log';
const rabbitMqBootstrapScriptPath = '/usr/local/bin/rd-shop-rabbitmq-bootstrap.sh';
const rabbitMqBootstrapServicePath = '/etc/systemd/system/rd-shop-rabbitmq-bootstrap.service';

interface BuildMessageBrokerUserDataArgs {
  brokerSecretArn: string;
  dataVolumeDeviceName: string;
  dataVolumeId: string;
  dataVolumeMountPath: string;
  image: string;
  port: number;
  region: string;
}

/**
 * Step 3 broker bootstrap helper.
 * Accepts the broker bootstrap secret ARN, attached volume metadata, container image, broker port, and AWS region.
 * Returns the cloud-init script that mounts the data volume, fetches broker credentials, and starts the RabbitMQ container on the EC2 broker host.
 */
export function buildMessageBrokerUserData({
  brokerSecretArn,
  dataVolumeDeviceName,
  dataVolumeId,
  dataVolumeMountPath,
  image,
  port,
  region,
}: BuildMessageBrokerUserDataArgs) {
  const normalizedDataVolumeId = dataVolumeId.replace(/-/g, '');
  const bootstrapScript = `#!/bin/bash
set -euo pipefail

exec > >(tee -a '${rabbitMqBootstrapLogPath}') 2>&1

resolved_device=''
expected_volume_id='${dataVolumeId}'
expected_volume_serial='${normalizedDataVolumeId}'

for attempt in {1..180}; do
  if [[ -b '${dataVolumeDeviceName}' ]]; then
    resolved_device='${dataVolumeDeviceName}'
    break
  fi

  device_by_id=$(find /dev/disk/by-id -maxdepth 1 -type l '(' -name "*$expected_volume_serial" -o -name "*$expected_volume_id" ')' | head -n 1 || true)
  if [[ -n "$device_by_id" ]]; then
    resolved_device=$(readlink -f "$device_by_id")
    break
  fi

  device_by_serial=$(lsblk -dn -o PATH,SERIAL | awk -v serial="$expected_volume_serial" '$2 == serial { print $1; exit }' || true)
  if [[ -n "$device_by_serial" ]]; then
    resolved_device="$device_by_serial"
    break
  fi

  sleep 2
done

if [[ -z "$resolved_device" ]]; then
  echo 'RabbitMQ data volume device not found' >&2
  echo 'Visible block devices:' >&2
  lsblk -dn -o PATH,SIZE,MODEL,SERIAL >&2 || true
  echo 'Visible by-id entries:' >&2
  ls -l /dev/disk/by-id >&2 || true
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

mountpoint -q '${dataVolumeMountPath}' || mount -a
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

if docker inspect --format '{{.State.Running}}' '${rabbitMqContainerName}' 2>/dev/null | grep -q '^true$'; then
  exit 0
fi

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

  return `#!/bin/bash
set -euo pipefail

dnf install -y awscli docker jq
systemctl enable --now docker

cat <<'RABBITMQ_BOOTSTRAP_SCRIPT' > ${rabbitMqBootstrapScriptPath}
${bootstrapScript}
RABBITMQ_BOOTSTRAP_SCRIPT

chmod 700 ${rabbitMqBootstrapScriptPath}

cat <<'RABBITMQ_BOOTSTRAP_UNIT' > ${rabbitMqBootstrapServicePath}
[Unit]
Description=rd-shop RabbitMQ bootstrap
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=${rabbitMqBootstrapScriptPath}
RemainAfterExit=yes
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
RABBITMQ_BOOTSTRAP_UNIT

systemctl daemon-reload
systemctl enable --now rd-shop-rabbitmq-bootstrap.service
`;
}
