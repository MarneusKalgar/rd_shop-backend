const natSysctlConfigPath = '/etc/sysctl.d/99-rd-shop-nat.conf';
const persistedIptablesPath = '/etc/sysconfig/iptables';

/**
 * Step 0.2 NAT bootstrap helper.
 * Accepts no arguments.
 * Returns the cloud-init shell script that enables IP forwarding, persists iptables rules, and turns an EC2 instance into the stack NAT host.
 */
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
