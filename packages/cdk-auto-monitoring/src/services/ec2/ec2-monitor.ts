import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface EC2Config extends BaseServiceConfig {
  instance: ec2.IInstance;
}

/**
 * EC2 Instance Monitor
 */
export class EC2Monitor implements ServiceMonitor {
  private readonly config: EC2Config;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: EC2Config) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const instanceId = this.config.resourceName;

    // Configure EC2 metrics
    this.metrics = [
      {
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'NetworkIn',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'NetworkOut',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'DiskReadBytes',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'DiskWriteBytes',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'DiskReadOps',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'DiskWriteOps',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_Instance',
        dimensions: { InstanceId: instanceId },
      },
      {
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_System',
        dimensions: { InstanceId: instanceId },
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
      // CPU Utilization
      new cloudwatch.GraphWidget({
        title: `EC2: ${resourceName} - CPU Utilization`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'CPUUtilization',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'CPU Utilization (%)',
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Network traffic
      new cloudwatch.GraphWidget({
        title: `EC2: ${resourceName} - Network Traffic`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'NetworkIn',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Network In (bytes)',
            color: cloudwatch.Color.BLUE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'NetworkOut',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Network Out (bytes)',
            color: cloudwatch.Color.GREEN,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Disk I/O bytes
      new cloudwatch.GraphWidget({
        title: `EC2: ${resourceName} - Disk I/O (Bytes)`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'DiskReadBytes',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Disk Read (bytes)',
            color: cloudwatch.Color.BLUE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'DiskWriteBytes',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Disk Write (bytes)',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Disk I/O operations
      new cloudwatch.GraphWidget({
        title: `EC2: ${resourceName} - Disk I/O (Operations)`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'DiskReadOps',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Disk Read Ops',
            color: cloudwatch.Color.BLUE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'DiskWriteOps',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Disk Write Ops',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Status checks
      new cloudwatch.SingleValueWidget({
        title: `EC2: ${resourceName} - Status Checks`,
        metrics: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'StatusCheckFailed',
            dimensionsMap: { InstanceId: resourceName },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Status Check Failed',
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
        namespace: 'AWS/EC2',
        dimensions: { InstanceId: resourceName },
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `EC2 instance ${resourceName} CPU utilization is high`,
      },
      {
        metricName: 'StatusCheckFailed',
        namespace: 'AWS/EC2',
        dimensions: { InstanceId: resourceName },
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.MAXIMUM,
        period: cdk.Duration.minutes(1),
        alarmDescription: `EC2 instance ${resourceName} status check failed`,
      },
    ];
  }
}
