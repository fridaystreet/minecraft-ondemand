import * as dotenv from 'dotenv';
import * as path from 'path';
import { MinecraftImageEnv, StackConfig } from './types';
import { stringAsBoolean } from './util';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const resolveMinecraftEnvVars = (json = ''): MinecraftImageEnv => {
  const defaults = { EULA: 'TRUE' };
  try {
    return {
      ...defaults,
      ...JSON.parse(json),
    };
  } catch (e) {
    console.error(
      'Unable to resolve .env value for MINECRAFT_IMAGE_ENV_VARS_JSON.\
      Defaults will be used'
    );
    return defaults;
  }
};

const {
  DOMAIN_NAME,
  SUBDOMAIN_PART,
  SERVER_REGION ,
  MINECRAFT_EDITION,
  SHUTDOWN_MINUTES,
  STARTUP_MINUTES,
  USE_FARGATE_SPOT,
  TASK_CPU,
  TASK_MEMORY,
  VPC_ID,
  MINECRAFT_IMAGE_ENV_VARS_JSON,
  SNS_EMAIL_ADDRESS,
  SNS_PHONE_NUMBER,
  TWILIO_PHONE_FROM,
  TWILIO_PHONE_TO,
  TWILIO_ACCOUNT_ID,
  TWILIO_AUTH_CODE,
  DEBUG
} = process.env;

export const resolveConfig = (): StackConfig => ({
  domainName: DOMAIN_NAME || '',
  subdomainPart: SUBDOMAIN_PART || 'pufferpanel',
  serverRegion: SERVER_REGION || 'us-east-1',
  minecraftEdition: MINECRAFT_EDITION || 'pufferpanel',
  shutdownMinutes: SHUTDOWN_MINUTES || '20',
  startupMinutes: STARTUP_MINUTES || '10',
  useFargateSpot: stringAsBoolean(USE_FARGATE_SPOT) || false,
  taskCpu: +(TASK_CPU || 1024),
  taskMemory: +(TASK_MEMORY || 2048),
  vpcId: VPC_ID || '',
  minecraftImageEnv: resolveMinecraftEnvVars(
    MINECRAFT_IMAGE_ENV_VARS_JSON
  ),
  snsEmailAddress: SNS_EMAIL_ADDRESS || '',
  snsPhoneNumber: SNS_PHONE_NUMBER || '',
  twilio: {
    phoneFrom: TWILIO_PHONE_FROM || '',
    phoneTo: TWILIO_PHONE_TO || '',
    accountId: TWILIO_ACCOUNT_ID || '',
    authCode: TWILIO_AUTH_CODE || '',
  },
  debug: stringAsBoolean(DEBUG) || false,
});
