const postgresContainerDataDir = '/var/lib/postgresql/data';
const postgresContainerPgDataDir = `${postgresContainerDataDir}/pgdata`;
const postgresHostBootstrapLogPath = '/var/log/rd-shop-postgres-bootstrap.log';
const postgresHostBootstrapScriptPath = '/usr/local/bin/rd-shop-postgres-bootstrap.sh';
const postgresHostBootstrapServicePath = '/etc/systemd/system/rd-shop-postgres-bootstrap.service';

interface BuildDatabaseHostUserDataArgs {
  bootstrapSecretArn: string;
  containerName: string;
  dataVolumeDeviceName: string;
  dataVolumeId: string;
  dataVolumeMountPath: string;
  image: string;
  port: number;
  region: string;
}

/**
 * Step 1.1 database-host bootstrap helper.
 * Accepts the bootstrap secret ARN, attached volume metadata, container image, and AWS region.
 * Returns the cloud-init script that mounts the data volume, fetches database credentials, initializes PostgreSQL, and starts the stage database container.
 */
export function buildDatabaseHostUserData({
  bootstrapSecretArn,
  containerName,
  dataVolumeDeviceName,
  dataVolumeId,
  dataVolumeMountPath,
  image,
  port,
  region,
}: BuildDatabaseHostUserDataArgs) {
  const postgresHostDataDir = `${dataVolumeMountPath}/pgdata`;
  const normalizedDataVolumeId = dataVolumeId.replace(/-/g, '');
  const bootstrapScript = `#!/bin/bash
set -euo pipefail

exec > >(tee -a '${postgresHostBootstrapLogPath}') 2>&1

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
  echo 'PostgreSQL data volume device not found' >&2
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

# A fresh ext4 volume root contains lost+found. Keep PGDATA on a subdirectory so
# the official Postgres image can initialize an empty data directory reliably.
mkdir -p '${postgresHostDataDir}'
chown -R 999:999 '${postgresHostDataDir}'

mkdir -p /etc/rd-shop /opt/rd-shop/postgres-init
aws secretsmanager get-secret-value \
  --region '${region}' \
  --secret-id '${bootstrapSecretArn}' \
  --query SecretString \
  --output text > /etc/rd-shop/postgres-bootstrap.json

POSTGRES_PASSWORD=$(jq -r '.POSTGRES_PASSWORD' /etc/rd-shop/postgres-bootstrap.json)
SHOP_DB_NAME=$(jq -r '.SHOP_DB_NAME' /etc/rd-shop/postgres-bootstrap.json)
SHOP_DB_USER=$(jq -r '.SHOP_DB_USER' /etc/rd-shop/postgres-bootstrap.json)
SHOP_DB_PASSWORD=$(jq -r '.SHOP_DB_PASSWORD' /etc/rd-shop/postgres-bootstrap.json)
PAYMENTS_DB_NAME=$(jq -r '.PAYMENTS_DB_NAME' /etc/rd-shop/postgres-bootstrap.json)
PAYMENTS_DB_USER=$(jq -r '.PAYMENTS_DB_USER' /etc/rd-shop/postgres-bootstrap.json)
PAYMENTS_DB_PASSWORD=$(jq -r '.PAYMENTS_DB_PASSWORD' /etc/rd-shop/postgres-bootstrap.json)

sql_escape_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

SHOP_DB_PASSWORD_ESCAPED=$(sql_escape_literal "$SHOP_DB_PASSWORD")
PAYMENTS_DB_PASSWORD_ESCAPED=$(sql_escape_literal "$PAYMENTS_DB_PASSWORD")

cat <<EOF > /opt/rd-shop/postgres-init/10-create-service-dbs.sql
CREATE USER "$SHOP_DB_USER" WITH PASSWORD '$SHOP_DB_PASSWORD_ESCAPED';
CREATE DATABASE "$SHOP_DB_NAME" OWNER "$SHOP_DB_USER";

CREATE USER "$PAYMENTS_DB_USER" WITH PASSWORD '$PAYMENTS_DB_PASSWORD_ESCAPED';
CREATE DATABASE "$PAYMENTS_DB_NAME" OWNER "$PAYMENTS_DB_USER";
EOF

if docker inspect --format '{{.State.Running}}' '${containerName}' 2>/dev/null | grep -q '^true$'; then
  exit 0
fi

docker rm -f '${containerName}' || true
docker run -d \
  --name '${containerName}' \
  --restart unless-stopped \
  -p ${port}:5432 \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e PGDATA='${postgresContainerPgDataDir}' \
  -v '${dataVolumeMountPath}:${postgresContainerDataDir}' \
  -v /opt/rd-shop/postgres-init/10-create-service-dbs.sql:/docker-entrypoint-initdb.d/10-create-service-dbs.sql:ro \
  '${image}'

for attempt in {1..60}; do
  if docker exec '${containerName}' pg_isready -h 127.0.0.1 -p 5432 -U postgres; then
    exit 0
  fi

  sleep 5
done

docker logs '${containerName}' || true
exit 1
`;

  return `#!/bin/bash
set -euo pipefail

# Keep xtrace off here because stage diagnostics may collect cloud-init output.

dnf install -y awscli docker jq
systemctl enable --now docker
cat <<'EOF' > ${postgresHostBootstrapScriptPath}
${bootstrapScript}
EOF

chmod 700 ${postgresHostBootstrapScriptPath}

cat <<'EOF' > ${postgresHostBootstrapServicePath}
[Unit]
Description=rd-shop stage PostgreSQL bootstrap
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=${postgresHostBootstrapScriptPath}
RemainAfterExit=yes
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rd-shop-postgres-bootstrap.service
`;
}
