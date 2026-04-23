import { config } from '../bootstrap';
import { getFoundationNetworkConfig } from './network-config';

const defaultPublicIngressIpv4Cidrs = ['0.0.0.0/0'];
const defaultAllTrafficPort = 0;
const allProtocols = '-1';
const tcpProtocol = 'tcp';

export const foundationSecurityGroupPorts = {
  albHttp: 80,
  albHttps: 443,
  ecsDynamicHostPortRangeEnd: 65535,
  ecsDynamicHostPortRangeStart: 32768,
  ecsPaymentsGrpc: 5001,
  ecsShopHttp: 8080,
  postgres: 5432,
  rabbitmqAmqp: 5672,
} as const;

export interface FoundationSecurityGroupConfig {
  allProtocols: string;
  allTrafficPort: number;
  anyIpv4Cidr: string;
  ports: typeof foundationSecurityGroupPorts;
  publicIngressIpv4Cidrs: string[];
  tcpProtocol: string;
}

/**
 * Step 0.3 config helper.
 * Accepts no arguments.
 * Resolves the security-group defaults and stack overrides used when building the network trust model.
 */
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

/**
 * Step 0.3 validation helper.
 * Accepts the public ingress CIDR list.
 * Throws when the ALB ingress surface would be created without any allowed source ranges.
 */
function validatePublicIngressCidrs(publicIngressIpv4Cidrs: string[]) {
  if (publicIngressIpv4Cidrs.length === 0) {
    throw new Error('publicIngressIpv4Cidrs must contain at least one CIDR block.');
  }
}
