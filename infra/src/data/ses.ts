import * as aws from '@pulumi/aws';

import { commonTags, isSharedInfraOwner, stackName } from '../bootstrap';
import { getFoundationSesConfig } from './ses-config';

/**
 * Step 1.5 / mail.
 * Accepts no arguments.
 * Creates the SES email identity used by the shop service and returns the identity metadata exported to later steps.
 */
export function createFoundationSes() {
  const sesConfig = getFoundationSesConfig();

  if (isSharedInfraOwner) {
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

  const existingShopSesIdentity = aws.sesv2.getEmailIdentityOutput({
    emailIdentity: sesConfig.fromAddress,
    region: sesConfig.region,
  });

  return {
    shopSesFromAddress: sesConfig.fromAddress,
    shopSesIdentity: existingShopSesIdentity.emailIdentity,
    shopSesIdentityArn: existingShopSesIdentity.arn,
    shopSesIdentityType: existingShopSesIdentity.identityType,
    shopSesVerificationStatus: existingShopSesIdentity.verificationStatus,
    shopSesVerifiedForSendingStatus: existingShopSesIdentity.verifiedForSendingStatus,
  };
}
