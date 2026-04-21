const natSysctlConfigPath = '/etc/sysctl.d/99-rd-shop-nat.conf';
const persistedIptablesPath = '/etc/sysconfig/iptables';

// Keeps NAT bootstrap isolated from Pulumi resource code.
// File now reads as infra orchestration, not mixed TS + shell blob.
export function buildNatInstanceUserData() {
  return `#!/bin/bash
set -euxo pipefail

dnf install -y iptables-services

cat <<'EOF' >${natSysctlConfigPath}
net.ipv4.ip_forward = 1
EOF

sysctl --system

primary_interface=$(ip route show default | awk '/default/ { print $5; exit }')

iptables -t nat -A POSTROUTING -o "$primary_interface" -j MASQUERADE
iptables -A FORWARD -i "$primary_interface" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -o "$primary_interface" -j ACCEPT

iptables-save >${persistedIptablesPath}
systemctl enable --now iptables
`;
}
