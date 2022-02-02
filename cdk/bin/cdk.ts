#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AlexaSkillStack } from '../lib/alexa-skill-stack';
import { PufferpanelStack } from '../lib/pufferpanel-stack';
import { DomainStack } from '../lib/domain-stack';
import { constants } from '../lib/constants';
import { resolveConfig } from '../lib/config';

const app = new cdk.App();

const config = resolveConfig();

if (!config.domainName) {
  throw new Error('Missing required `DOMAIN_NAME` in .env file, please rename\
    `.env.sample` to `.env` and add your domain name.');
}

const domainStack = new DomainStack(app, 'pufferpanel-domain-stack', {
  env: {
    /**
     * Because we are relying on Route 53+CloudWatch to invoke the Lambda function,
     * it _must_ reside in the N. Virginia (us-east-1) region.
     */
    region: constants.DOMAIN_STACK_REGION,
    /* Account must be specified to allow for hosted zone lookup */
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  config,
});

const pufferpanelStack = new PufferpanelStack(app, 'pufferpanel-server-stack', {
  env: {
    region: config.serverRegion,
    /* Account must be specified to allow for VPC lookup */
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  config,
});

const alexaSkillStack = new AlexaSkillStack(app, 'pufferpanel-alexa-skill-stack', {
  env: {
    region: config.serverRegion,
    /* Account must be specified to allow for VPC lookup */
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  config,
});

if (!config.disableAlexaStartupSkill) {
  pufferpanelStack.addDependency(alexaSkillStack);
}
pufferpanelStack.addDependency(domainStack);
