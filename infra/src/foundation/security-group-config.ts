import { config } from '../bootstrap';
import { getFoundationNetworkConfig } from './network-config';

const defaultPublicIngressIpv4Cidrs = ['0.0.0.0/0'];
const defaultAllTrafficPort = 0;
const allProtocols = '-1';
const tcpProtocol = 'tcp';

export const foundationSecurityGroupPorts = {
  albHttp: 80,
  albHttps: 443,
  amqps: 5671,
  ecsPaymentsGrpc: 5001,
  ecsShopHttp: 8080,
  postgres: 5432,
} as const;

export interface FoundationSecurityGroupConfig {
  allProtocols: string;
  allTrafficPort: number;
  anyIpv4Cidr: string;
  ports: typeof foundationSecurityGroupPorts;
  publicIngressIpv4Cidrs: string[];
  tcpProtocol: string;
}

// Keeps Phase 0.3 defaults and stack overrides in one place.
export function getFoundationSecurityGroupConfig(): FoundationSecurityGroupConfig {
  const networkConfig = getFoundationNetworkConfig();
  const publicIngressIpv4Cidrs =
    config.getObject<string[]>('publicIngressIpv4Cidrs') ?? defaultPublicIngressIpv4Cidrs;

  validatePublicIngressCidrs(publicIngressIpv4Cidrs);

  return {
    allProtocols,
    allTrafficPort: networkConfig.allTrafficPort ?? defaultAllTrafficPort,
    anyIpv4Cidr: networkConfig.anyIpv4Cidr,
    ports: foundationSecurityGroupPorts,
    publicIngressIpv4Cidrs,
    tcpProtocol,
  };
}

function validatePublicIngressCidrs(publicIngressIpv4Cidrs: string[]) {
  if (publicIngressIpv4Cidrs.length === 0) {
    throw new Error('publicIngressIpv4Cidrs must contain at least one CIDR block.');
  }
}
