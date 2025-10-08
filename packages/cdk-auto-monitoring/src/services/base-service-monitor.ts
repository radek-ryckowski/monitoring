import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cdk from 'aws-cdk-lib';

/**
 * Basic metric configuration for internal service monitoring
 * This is the minimal interface needed by service monitors
 */
export interface MetricConfiguration {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions?: { [key: string]: string };
}

/**
 * Base interface for service monitoring
 */
export interface ServiceMonitor {
  /**
   * Enable monitoring for the service
   */
  enableMonitoring(): void;

  /**
   * Get metric configurations for this service
   */
  getMetricConfigurations(): MetricConfiguration[];

  /**
   * Create dashboard widgets for this service
   */
  createDashboardWidgets(): cloudwatch.IWidget[];

  /**
   * Get alarm definitions for this service
   */
  getAlarmDefinitions(): AlarmDefinition[];
}

/**
 * Alarm definition
 */
export interface AlarmDefinition {
  metricName: string;
  namespace: string;
  dimensions: { [key: string]: string };
  threshold: number;
  comparisonOperator: cloudwatch.ComparisonOperator;
  evaluationPeriods: number;
  statistic: cloudwatch.Statistic;
  period: cdk.Duration;
  alarmDescription: string;
}

/**
 * Base configuration for service monitoring
 */
export interface BaseServiceConfig {
  resourceName: string;
  detailedMonitoring?: boolean;
  customMetrics?: MetricConfiguration[];
  region?: string;
}
