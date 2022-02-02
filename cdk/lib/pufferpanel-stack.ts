import * as path from 'path';
import {
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_lambda as lambda,
  aws_efs as efs,
  aws_iam as iam,
  aws_ecs as ecs,
  aws_logs as logs,
  aws_sns as sns,
  RemovalPolicy,
  Arn,
  ArnFormat,
} from 'aws-cdk-lib';
import { Port } from 'aws-cdk-lib/lib/aws-ec2';
import { Protocol } from 'aws-cdk-lib/lib/aws-ecs';
import { Construct } from 'constructs';
import { constants } from './constants';
import { SSMParameterReader } from './ssm-parameter-reader';
import { StackConfig } from './types';
import { isDockerInstalled } from './util';

interface PufferpanelStackProps extends StackProps {
  config: Readonly<StackConfig>;
}

export class PufferpanelStack extends Stack {
  constructor(scope: Construct, id: string, props: PufferpanelStackProps) {
    super(scope, id, props);

    const { config } = props;

    const vpc = config.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: config.vpcId })
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 3,
          natGateways: 0,
        });

    const fileSystem = new efs.FileSystem(this, 'FileSystem', {
      vpc,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    const configAccessPoint = new efs.AccessPoint(this, 'ConfigAccessPoint', {
      fileSystem,
      path: '/pufferpanel/config',
      posixUser: {
        uid: '0',
        gid: '0',
      },
      createAcl: {
        ownerGid: '0',
        ownerUid: '0',
        permissions: '0755',
      },
    });

    const serversAccessPoint = new efs.AccessPoint(this, 'ServersAccessPoint', {
      fileSystem,
      path: '/pufferpanel/servers',
      posixUser: {
        uid: '0',
        gid: '0',
      },
      createAcl: {
        ownerGid: '0',
        ownerUid: '0',
        permissions: '0755',
      },
    });

    const emailsAccessPoint = new efs.AccessPoint(this, 'EmailsAccessPoint', {
      fileSystem,
      path: '/pufferpanel/email',
      posixUser: {
        uid: '0',
        gid: '0',
      },
      createAcl: {
        ownerGid: '0',
        ownerUid: '0',
        permissions: '0755',
      },
    });

    const configEfsReadWriteDataPolicy = new iam.Policy(this, 'ConfigDataRWPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowReadWriteOnEFS',
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:DescribeFileSystems',
          ],
          resources: [fileSystem.fileSystemArn],
          conditions: {
            StringEquals: {
              'elasticfilesystem:AccessPointArn': configAccessPoint.accessPointArn,
            },
          },
        }),
      ],
    });

    const serversEfsReadWriteDataPolicy = new iam.Policy(this, 'ServersDataRWPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowReadWriteOnEFS',
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:DescribeFileSystems',
          ],
          resources: [fileSystem.fileSystemArn],
          conditions: {
            StringEquals: {
              'elasticfilesystem:AccessPointArn': serversAccessPoint.accessPointArn,
            },
          },
        }),
      ],
    });
    const emailsEfsReadWriteDataPolicy = new iam.Policy(this, 'EmailsDataRWPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowReadWriteOnEFS',
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:DescribeFileSystems',
          ],
          resources: [fileSystem.fileSystemArn],
          conditions: {
            StringEquals: {
              'elasticfilesystem:AccessPointArn': emailsAccessPoint.accessPointArn,
            },
          },
        }),
      ],
    });

    const ecsTaskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Pufferpanel ECS task role',
    });

    configEfsReadWriteDataPolicy.attachToRole(ecsTaskRole);
    serversEfsReadWriteDataPolicy.attachToRole(ecsTaskRole);
    emailsEfsReadWriteDataPolicy.attachToRole(ecsTaskRole);

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: constants.CLUSTER_NAME,
      vpc,
      containerInsights: true, // TODO: Add config for container insights
      enableFargateCapacityProviders: true,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'TaskDefinition',
      {
        taskRole: ecsTaskRole,
        memoryLimitMiB: config.taskMemory,
        cpu: config.taskCpu,
        volumes: [
          {
            name: constants.ECS_CONFIG_VOLUME_NAME,
            efsVolumeConfiguration: {
              fileSystemId: fileSystem.fileSystemId,
              transitEncryption: 'ENABLED',
              authorizationConfig: {
                accessPointId: configAccessPoint.accessPointId,
                iam: 'ENABLED',
              },
            },
          },
          {
            name: constants.ECS_SERVERS_VOLUME_NAME,
            efsVolumeConfiguration: {
              fileSystemId: fileSystem.fileSystemId,
              transitEncryption: 'ENABLED',
              authorizationConfig: {
                accessPointId: serversAccessPoint.accessPointId,
                iam: 'ENABLED',
              },
            },
          },
          {
            name: constants.ECS_EMAILS_VOLUME_NAME,
            efsVolumeConfiguration: {
              fileSystemId: fileSystem.fileSystemId,
              transitEncryption: 'ENABLED',
              authorizationConfig: {
                accessPointId: emailsAccessPoint.accessPointId,
                iam: 'ENABLED',
              },
            },
          },
        ],
      }
    );

    const createPortMappings = (hostPort: number, containerPort: number, protocol: Protocol, count: number ) => {
      return Array(count).map((v, i) => ({
        containerPort: containerPort+i,
        hostPort: hostPort+i,
        protocol
      }));
    }

    const pufferpanelServerContainer = new ecs.ContainerDefinition(
      this,
      'ServerContainer',
      {
        containerName: constants.MC_SERVER_CONTAINER_NAME,
        image: ecs.ContainerImage.fromRegistry(constants.PUFFER_PANEL_DOCKER_IMAGE),
        portMappings: [
          {
            containerPort: 8080,
            hostPort: 8080,
            protocol: Protocol.TCP,
          },
          {
            containerPort: 5657,
            hostPort: 5657,
            protocol: Protocol.TCP
          },
          {
            containerPort: 25565,
            hostPort: 25565,
            protocol: Protocol.TCP
          },
          {
            containerPort: 19132,
            hostPort: 19132,
            protocol: Protocol.UDP
          }
          // ...createPortMappings(25565, 25565, Protocol.TCP, 5),
          // ...createPortMappings(19132, 19132, Protocol.UDP, 5)
        ],
        environment: config.minecraftImageEnv,
        essential: false,
        taskDefinition,
        logging: config.debug
          ? new ecs.AwsLogDriver({
              logRetention: logs.RetentionDays.THREE_DAYS,
              streamPrefix: constants.MC_SERVER_CONTAINER_NAME,
            })
          : undefined,
      }
    );

    pufferpanelServerContainer.addMountPoints({
      containerPath: '/etc/pufferpanel',
      sourceVolume: constants.ECS_CONFIG_VOLUME_NAME,
      readOnly: false,
    });

    pufferpanelServerContainer.addMountPoints({
      containerPath: '/var/lib/pufferpanel/servers',
      sourceVolume: constants.ECS_SERVERS_VOLUME_NAME,
      readOnly: false,
    });

    pufferpanelServerContainer.addMountPoints({
      containerPath: '/pufferpanel/email',
      sourceVolume: constants.ECS_EMAILS_VOLUME_NAME,
      readOnly: false,
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      'ServiceSecurityGroup',
      {
        vpc,
        description: 'Security group for Pufferpanel on-demand',
      }
    );

    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      Port.tcp(8080),
    );

    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      Port.tcp(5657),
    );

    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      Port.tcpRange(25565, 25665),
    );

    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      Port.udpRange(19132, 19232),
    );

    const pufferpanelServerService = new ecs.FargateService(
      this,
      'FargateService',
      {
        cluster,
        capacityProviderStrategies: [
          {
            capacityProvider: config.useFargateSpot
              ? 'FARGATE_SPOT'
              : 'FARGATE',
            weight: 1,
            base: 1,
          },
        ],
        taskDefinition: taskDefinition,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        serviceName: constants.SERVICE_NAME,
        desiredCount: 0,
        assignPublicIp: true,
        securityGroups: [serviceSecurityGroup],
      }
    );

    /* Allow access to EFS from Fargate service security group */
    fileSystem.connections.allowDefaultPortFrom(
      pufferpanelServerService.connections
    );

    const hostedZoneId = new SSMParameterReader(
      this,
      'Route53HostedZoneIdReader',
      {
        parameterName: `${constants.SSM_PARAM_PREFIX}${constants.HOSTED_ZONE_SSM_PARAMETER}`,
        region: constants.DOMAIN_STACK_REGION,
      }
    ).getParameterValue();

    let snsTopicArn = '';
    /* Create SNS Topic if SNS_EMAIL is provided */
    if (config.snsEmailAddress || config.snsPhoneNumber) {

      const snsTopic = new sns.Topic(this, 'ServerSnsTopic', {
        displayName: 'Minecraft Server Notifications',
      });

      snsTopic.grantPublish(ecsTaskRole);
      if (config.snsEmailAddress) {
        const emailSubscription = new sns.Subscription(
          this,
          'EmailSubscription',
          {
            protocol: sns.SubscriptionProtocol.EMAIL,
            topic: snsTopic,
            endpoint: config.snsEmailAddress,
          }
        );
      }

      if (config.snsPhoneNumber) {
        const smsSubscription = new sns.Subscription(
          this,
          'SMSSubscription',
          {
            protocol: sns.SubscriptionProtocol.SMS,
            topic: snsTopic,
            endpoint: config.snsPhoneNumber,
          }
        );
      }

      snsTopicArn = snsTopic.topicArn;
    }

    const watchdogContainer = new ecs.ContainerDefinition(
      this,
      'WatchDogContainer',
      {
        containerName: constants.WATCHDOG_SERVER_CONTAINER_NAME,
        image: isDockerInstalled() && false
          ? ecs.ContainerImage.fromAsset(
              path.resolve(__dirname, '../../minecraft-ecsfargate-watchdog/')
            )
          : ecs.ContainerImage.fromRegistry(
              'fridaystreet/minecraft-ecsfargate-watchdog'
            ),
        essential: true,
        taskDefinition: taskDefinition,
        environment: {
          CLUSTER: constants.CLUSTER_NAME,
          SERVICE: constants.SERVICE_NAME,
          DNSZONE: hostedZoneId,
          EDITION: 'java',
          SERVERNAME: `${config.subdomainPart}.${config.domainName}`,
          SNSTOPIC: snsTopicArn,
          TWILIOFROM: config.twilio.phoneFrom,
          TWILIOTO: config.twilio.phoneTo,
          TWILIOAID: config.twilio.accountId,
          TWILIOAUTH: config.twilio.authCode,
          STARTUPMIN: config.startupMinutes,
          SHUTDOWNMIN: config.shutdownMinutes,
        },
        logging: config.debug
          ? new ecs.AwsLogDriver({
              logRetention: logs.RetentionDays.THREE_DAYS,
              streamPrefix: constants.WATCHDOG_SERVER_CONTAINER_NAME,
            })
          : undefined,
      }
    );

    const serviceControlPolicy = new iam.Policy(this, 'ServiceControlPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowAllOnServiceAndTask',
          effect: iam.Effect.ALLOW,
          actions: ['ecs:*'],
          resources: [
            pufferpanelServerService.serviceArn,
            /* arn:aws:ecs:<region>:<account_number>:task/minecraft/* */
            Arn.format(
              {
                service: 'ecs',
                resource: 'task',
                resourceName: `${constants.CLUSTER_NAME}/*`,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              },
              this
            ),
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:DescribeNetworkInterfaces'],
          resources: ['*'],
        }),
      ],
    });

    serviceControlPolicy.attachToRole(ecsTaskRole);

    const alexaLauncherLambdaRoleArn = new SSMParameterReader(
      this,
      'alexaLauncherLambdaRoleArn',
      {
        parameterName: `${constants.SSM_PARAM_PREFIX}${constants.ALEXA_LAUNCHER_LAMBDA_ARN_SSM_PARAMETER}`,
        region: config.serverRegion,
      }
    ).getParameterValue();


    const alexaLauncherLambdaRole = iam.Role.fromRoleArn(
      this,
      'alexaLauncherLambdaRole',
      alexaLauncherLambdaRoleArn
    );

    serviceControlPolicy.attachToRole(alexaLauncherLambdaRole);
    /**
     * Add service control policy to the launcher lambda from the other stack
     */
    const launcherLambdaRoleArn = new SSMParameterReader(
      this,
      'launcherLambdaRoleArn',
      {
        parameterName: `${constants.SSM_PARAM_PREFIX}${constants.LAUNCHER_LAMBDA_ARN_SSM_PARAMETER}`,
        region: constants.DOMAIN_STACK_REGION,
      }
    ).getParameterValue();

    const launcherLambdaRole = iam.Role.fromRoleArn(
      this,
      'LauncherLambdaRole',
      launcherLambdaRoleArn
    );
    serviceControlPolicy.attachToRole(launcherLambdaRole);

    /**
     * This policy gives permission to our ECS task to update the A record
     * associated with our minecraft server. Retrieve the hosted zone identifier
     * from Route 53 and place it in the Resource line within this policy.
     */
    const iamRoute53Policy = new iam.Policy(this, 'IamRoute53Policy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowEditRecordSets',
          effect: iam.Effect.ALLOW,
          actions: [
            'route53:GetHostedZone',
            'route53:ChangeResourceRecordSets',
            'route53:ListResourceRecordSets',
          ],
          resources: [`arn:aws:route53:::hostedzone/${hostedZoneId}`],
        }),
      ],
    });
    iamRoute53Policy.attachToRole(ecsTaskRole);
  }
}
