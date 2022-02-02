/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import * as path from 'path';
import {
  Stack,
  StackProps,
  aws_lambda as lambda,
  aws_ssm as ssm,
  aws_logs as logs,
  SecretValue
} from 'aws-cdk-lib';
import { Skill } from 'cdk-alexa-skill';
import { Construct } from 'constructs';
import { constants } from './constants';
import { StackConfig } from './types';

interface PufferpanelStackProps extends StackProps {
  config: Readonly<StackConfig>;
}

export class AlexaSkillStack extends Stack {
  constructor(scope: Construct, id: string, props: PufferpanelStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Get Alexa Developer credentials from SSM Parameter Store
    const alexaVendorId = ssm.StringParameter.valueForStringParameter(this, `${constants.SSM_PARAM_PREFIX}alexa-vendor-id`);
    const lwaClientId = ssm.StringParameter.valueForStringParameter(this, `${constants.SSM_PARAM_PREFIX}alexa-client-id`);
    const lwaClientSecret = SecretValue.secretsManager(`${constants.SSM_PARAM_PREFIX}alexa_client-secret`);
    const lwaRefreshToken = SecretValue.secretsManager(`${constants.SSM_PARAM_PREFIX}alexa_refresh-token`);
    
    // Create the Lambda Function for the Skill Backend
    const alexaLauncherLambda = new lambda.Function(this, 'AlexaLauncherLambda', {
      code: lambda.Code.fromAsset(path.resolve(__dirname, '../../lambda/alexa-startup-skill')),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      environment: {
        REGION: config.serverRegion,
        CLUSTER: constants.CLUSTER_NAME,
        SERVICE: constants.SERVICE_NAME,
        SERVERNAME: `${config.subdomainPart}.${config.domainName}`
      },
      logRetention: logs.RetentionDays.THREE_DAYS, // TODO: parameterize
    });

    /**
     * Add the ARN for the launcher lambda execution role to SSM so we can
     * attach the policy for accessing the minecraft server after it has been
     * created.
     */
     new ssm.StringParameter(this, 'AlexaLauncherLambdaParam', {
      allowedPattern: '.*S.*',
      description: 'Minecraft alexa launcher execution role ARN',
      parameterName: `${constants.SSM_PARAM_PREFIX}${constants.ALEXA_LAUNCHER_LAMBDA_ARN_SSM_PARAMETER}`,
      stringValue: alexaLauncherLambda.role?.roleArn || '',
    });

    // Create the Alexa Skill
    new Skill(this, 'Skill', {
      endpointLambdaFunction: alexaLauncherLambda,
      skillPackagePath: 'lib/alexa-skill-package',
      alexaVendorId: alexaVendorId,
      lwaClientId: lwaClientId,
      lwaClientSecret: lwaClientSecret,
      lwaRefreshToken: lwaRefreshToken
    });
  }
}
