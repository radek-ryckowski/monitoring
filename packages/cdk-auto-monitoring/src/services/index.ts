/**
 * Service Monitor Registry
 * Exports all service-specific monitors
 */

export * from './base-service-monitor';
export * from './ecs';
export * from './lambda';
export * from './rds';
export * from './dynamodb';
export * from './alb';
export * from './nlb';
export * from './ec2';
export * from './s3';

// Import for registry
import { ServiceMonitor } from './base-service-monitor';
import { ECSServiceMonitor, ECSClusterMonitor } from './ecs';
import { LambdaMonitor } from './lambda';
import { RDSMonitor } from './rds';
import { DynamoDBMonitor } from './dynamodb';
import { ALBMonitor } from './alb';
import { NLBMonitor } from './nlb';
import { EC2Monitor } from './ec2';
import { S3Monitor } from './s3';

/**
 * Service monitor factory
 */
export const ServiceMonitorFactory = {
  ECSService: ECSServiceMonitor,
  ECSCluster: ECSClusterMonitor,
  Lambda: LambdaMonitor,
  RDS: RDSMonitor,
  DynamoDB: DynamoDBMonitor,
  ALB: ALBMonitor,
  NLB: NLBMonitor,
  EC2: EC2Monitor,
  S3: S3Monitor,
};

export type ServiceMonitorType = keyof typeof ServiceMonitorFactory;
