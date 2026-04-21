export function buildComputeUserData(clusterName: string) {
  return `#!/bin/bash
set -euxo pipefail

cat <<'EOF' >/etc/ecs/ecs.config
ECS_CLUSTER=${clusterName}
ECS_ENABLE_TASK_IAM_ROLE=true
ECS_ENABLE_TASK_IAM_ROLE_NETWORK_HOST=true
EOF

systemctl enable --now ecs
`;
}
