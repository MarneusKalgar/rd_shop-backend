const ecsAgentContainerName = 'amazon-ecs-agent';
const ecsBootstrapScriptPath = '/usr/local/bin/rd-shop-start-ecs.sh';
const ecsBootstrapUnitName = 'rd-shop-ecs-bootstrap.service';
const ecsBootstrapUnitPath = `/etc/systemd/system/${ecsBootstrapUnitName}`;
const ecsConfigPath = '/etc/ecs/ecs.config';
const ecsLogDir = '/var/log/ecs';
const ecsMetadataUrl = 'http://localhost:51678/v1/metadata';

/**
 * Step 2.2 host bootstrap helper.
 * Accepts the ECS cluster name.
 * Returns the cloud-init script that writes ECS config, waits for Docker readiness, and starts the deferred ECS bootstrap unit on the EC2 host.
 */
export function buildComputeUserData(clusterName: string) {
  return `#!/bin/bash
set -euxo pipefail

mkdir -p /etc/ecs '${ecsLogDir}'

cat <<'EOF' >${ecsConfigPath}
ECS_CLUSTER=${clusterName}
ECS_ENABLE_TASK_IAM_ROLE=true
ECS_ENABLE_TASK_IAM_ROLE_NETWORK_HOST=true
ECS_LOGLEVEL=debug
EOF

cat <<'SCRIPT' >${ecsBootstrapScriptPath}
#!/bin/bash
set -euxo pipefail

dump_ecs_diagnostics() {
  echo 'ECS bootstrap failed; dumping diagnostics.' >&2
  systemctl status docker --no-pager || true
  systemctl status ecs --no-pager || true
  journalctl -u docker -n 200 --no-pager || true
  journalctl -u ecs -n 200 --no-pager || true
  if [[ -d '${ecsLogDir}' ]]; then
    find '${ecsLogDir}' -maxdepth 1 -type f -print -exec tail -n 200 {} \\; || true
  fi
  docker ps -a || true
  docker logs '${ecsAgentContainerName}' || true
  curl -fsS '${ecsMetadataUrl}' || true
}

handle_exit() {
  exit_code=$?

  if [[ $exit_code -ne 0 ]]; then
    dump_ecs_diagnostics
  fi

  exit $exit_code
}

trap handle_exit EXIT

systemctl start ecs

for attempt in {1..60}; do
  metadata=$(curl -fsS '${ecsMetadataUrl}' || true)
  if [[ -n "$metadata" ]] && grep -q 'ContainerInstanceArn' <<<"$metadata"; then
    exit 0
  fi

  sleep 5
done

echo 'ECS agent did not register with the cluster in time.' >&2
exit 1
SCRIPT

chmod 755 ${ecsBootstrapScriptPath}

cat <<'UNIT' >${ecsBootstrapUnitPath}
[Unit]
Description=Start ECS agent after cloud-init final phase
After=cloud-final.service docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=${ecsBootstrapScriptPath}
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl enable docker
systemctl start docker

for attempt in {1..30}; do
  if docker info >/dev/null 2>&1; then
    break
  fi

  sleep 2
done

if ! docker info >/dev/null 2>&1; then
  echo 'Docker daemon did not become ready in time.' >&2
  exit 1
fi

systemctl enable ecs
systemctl daemon-reload
systemctl enable ${ecsBootstrapUnitName}
systemctl start --no-block ${ecsBootstrapUnitName}
`;
}
