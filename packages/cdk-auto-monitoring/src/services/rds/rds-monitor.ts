import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface RDSConfig extends BaseServiceConfig {
  instance: rds.IDatabaseInstance;
  enableEnhancedMonitoring?: boolean;
  enablePerformanceInsights?: boolean;
}

/**
 * RDS Instance Monitor
 */
export class RDSMonitor implements ServiceMonitor {
  private readonly config: RDSConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: RDSConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const { instance, enableEnhancedMonitoring = true, enablePerformanceInsights = true } = this.config;

    // Enable Enhanced Monitoring and Performance Insights on the instance
    if (instance instanceof rds.DatabaseInstance) {
      const cfnInstance = instance.node.defaultChild as rds.CfnDBInstance;

      if (enableEnhancedMonitoring) {
        cfnInstance.addPropertyOverride('MonitoringInterval', 60);
      }

      if (enablePerformanceInsights) {
        cfnInstance.addPropertyOverride('EnablePerformanceInsights', true);
        cfnInstance.addPropertyOverride('PerformanceInsightsRetentionPeriod', 7);
      }
    }

    // Configure RDS metrics
    this.metrics = [
      {
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'DatabaseConnections',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'FreeableMemory',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'FreeStorageSpace',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'ReadLatency',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'WriteLatency',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'ReadIOPS',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
      {
        namespace: 'AWS/RDS',
        metricName: 'WriteIOPS',
        dimensions: { DBInstanceIdentifier: this.config.resourceName },
      },
    ];

    if (this.config.customMetrics) {
      this.metrics.push(...this.config.customMetrics);
    }
  }

  getMetricConfigurations(): MetricConfiguration[] {
    return this.metrics;
  }

  createDashboardWidgets(): cloudwatch.IWidget[] {
    const { resourceName, region } = this.config;

    return [
      // CPU and Connections
      new cloudwatch.GraphWidget({
        title: `RDS: ${resourceName} - CPU & Connections`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'CPU %',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Connections',
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Memory and Storage
      new cloudwatch.GraphWidget({
        title: `RDS: ${resourceName} - Memory & Storage`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'FreeableMemory',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
            label: 'Free Memory',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'FreeStorageSpace',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
            label: 'Free Storage',
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Latency
      new cloudwatch.GraphWidget({
        title: `RDS: ${resourceName} - Latency`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'ReadLatency',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Read Latency',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'WriteLatency',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Write Latency',
          }),
        ],
        width: 6,
        height: 6,
      }),

      // IOPS
      new cloudwatch.GraphWidget({
        title: `RDS: ${resourceName} - IOPS`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'ReadIOPS',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Read IOPS',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'WriteIOPS',
            dimensionsMap: { DBInstanceIdentifier: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Write IOPS',
          }),
        ],
        width: 6,
        height: 6,
      }),
    ];
  }

  getAlarmDefinitions(): AlarmDefinition[] {
    const { resourceName } = this.config;

    return [
      {
        metricName: 'CPUUtilization',
        namespace: 'AWS/RDS',
        dimensions: { DBInstanceIdentifier: resourceName },
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `RDS instance ${resourceName} CPU utilization is above 80%`,
      },
      {
        metricName: 'FreeStorageSpace',
        namespace: 'AWS/RDS',
        dimensions: { DBInstanceIdentifier: resourceName },
        threshold: 10737418240, // 10 GB in bytes
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `RDS instance ${resourceName} free storage space is below 10 GB`,
      },
      {
        metricName: 'DatabaseConnections',
        namespace: 'AWS/RDS',
        dimensions: { DBInstanceIdentifier: resourceName },
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `RDS instance ${resourceName} has more than 80 connections`,
      },
    ];
  }
}
