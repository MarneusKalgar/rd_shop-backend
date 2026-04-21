import * as aws from '@pulumi/aws';

import { commonTags, stackName } from '../bootstrap';
import { getFoundationSesConfig } from './ses-config';

export function createFoundationSes() {
  const sesConfig = getFoundationSesConfig();

  const shopSesIdentity = new aws.sesv2.EmailIdentity(stackName('shop-ses-identity'), {
    emailIdentity: sesConfig.fromAddress,
    region: sesConfig.region,
    tags: {
      ...commonTags,
      Component: 'mail',
      Name: sesConfig.fromAddress,
      Scope: 'private',
      Service: 'shop',
    },
  });

  return {
    shopSesFromAddress: sesConfig.fromAddress,
    shopSesIdentity: shopSesIdentity.emailIdentity,
    shopSesIdentityArn: shopSesIdentity.arn,
    shopSesIdentityType: shopSesIdentity.identityType,
    shopSesVerificationStatus: shopSesIdentity.verificationStatus,
    shopSesVerifiedForSendingStatus: shopSesIdentity.verifiedForSendingStatus,
  };
}
