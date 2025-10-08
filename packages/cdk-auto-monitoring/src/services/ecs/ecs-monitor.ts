import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface ECSServiceConfig extends BaseServiceConfig {
  service: ecs.FargateService | ecs.Ec2Service;
  clusterName: string;
  enableContainerInsights?: boolean;
}

export interface ECSClusterConfig extends BaseServiceConfig {
  cluster: ecs.ICluster;
  enableContainerInsights?: boolean;
}

/**
 * ECS Service Monitor
 */
export class ECSServiceMonitor implements ServiceMonitor {
  private readonly config: ECSServiceConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: ECSServiceConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const { service, clusterName, enableContainerInsights = true } = this.config;

    // Enable Container Insights on the cluster
    if (enableContainerInsights) {
      const cluster = service.cluster as ecs.Cluster;
      if (cluster.node.defaultChild) {
        const cfnCluster = cluster.node.defaultChild as ecs.CfnCluster;
        cfnCluster.addPropertyOverride('ClusterSettings', [
          {
            Name: 'containerInsights',
            Value: 'enabled',
          },
        ]);
      }
    }

    // Configure metrics
    this.metrics = [
      {
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensions: { ServiceName: this.config.resourceName, ClusterName: clusterName },
      },
      {
        namespace: 'AWS/ECS',
        metricName: 'MemoryUtilization',
        dimensions: { ServiceName: this.config.resourceName, ClusterName: clusterName },
      },
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'RunningTaskCount',
        dimensions: { ServiceName: this.config.resourceName, ClusterName: clusterName },
      },
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'DesiredTaskCount',
        dimensions: { ServiceName: this.config.resourceName, ClusterName: clusterName },
      },
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'PendingTaskCount',
        dimensions: { ServiceName: this.config.resourceName, ClusterName: clusterName },
      },
    ];

    // Add custom metrics
    if (this.config.customMetrics) {
      this.metrics.push(...this.config.customMetrics);
    }
  }

  getMetricConfigurations(): MetricConfiguration[] {
    return this.metrics;
  }

  createDashboardWidgets(): cloudwatch.IWidget[] {
    const { resourceName, clusterName, region } = this.config;

    return [
      // CPU and Memory utilization
      new cloudwatch.GraphWidget({
        title: `ECS Service: ${resourceName} - CPU & Memory`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            dimensionsMap: { ServiceName: resourceName, ClusterName: clusterName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            dimensionsMap: { ServiceName: resourceName, ClusterName: clusterName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Task count
      new cloudwatch.GraphWidget({
        title: `ECS Service: ${resourceName} - Task Count`,
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'RunningTaskCount',
            dimensionsMap: { ServiceName: resourceName, ClusterName: clusterName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Running',
          }),
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'DesiredTaskCount',
            dimensionsMap: { ServiceName: resourceName, ClusterName: clusterName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Desired',
          }),
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'PendingTaskCount',
            dimensionsMap: { ServiceName: resourceName, ClusterName: clusterName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Pending',
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  getAlarmDefinitions(): AlarmDefinition[] {
    const { resourceName, clusterName } = this.config;

    return [
      {
        metricName: 'CPUUtilization',
        namespace: 'AWS/ECS',
        dimensions: { ServiceName: resourceName, ClusterName: clusterName },
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `ECS Service ${resourceName} CPU utilization is above 80%`,
      },
      {
        metricName: 'MemoryUtilization',
        namespace: 'AWS/ECS',
        dimensions: { ServiceName: resourceName, ClusterName: clusterName },
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `ECS Service ${resourceName} memory utilization is above 80%`,
      },
    ];
  }
}

/**
 * ECS Cluster Monitor
 */
export class ECSClusterMonitor implements ServiceMonitor {
  private readonly config: ECSClusterConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: ECSClusterConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const { cluster, enableContainerInsights = true } = this.config;

    // Enable Container Insights
    if (enableContainerInsights && cluster instanceof ecs.Cluster) {
      if (cluster.node.defaultChild) {
        const cfnCluster = cluster.node.defaultChild as ecs.CfnCluster;
        cfnCluster.addPropertyOverride('ClusterSettings', [
          {
            Name: 'containerInsights',
            Value: 'enabled',
          },
        ]);
      }
    }

    // Configure metrics
    this.metrics = [
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'ClusterCPUUtilization',
        dimensions: { ClusterName: this.config.resourceName },
      },
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'ClusterMemoryUtilization',
        dimensions: { ClusterName: this.config.resourceName },
      },
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'ClusterServiceCount',
        dimensions: { ClusterName: this.config.resourceName },
      },
      {
        namespace: 'ECS/ContainerInsights',
        metricName: 'ClusterTaskCount',
        dimensions: { ClusterName: this.config.resourceName },
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
      new cloudwatch.GraphWidget({
        title: `ECS Cluster: ${resourceName} - Utilization`,
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'ClusterCPUUtilization',
            dimensionsMap: { ClusterName: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'ClusterMemoryUtilization',
            dimensionsMap: { ClusterName: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: `ECS Cluster: ${resourceName} - Services & Tasks`,
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'ClusterServiceCount',
            dimensionsMap: { ClusterName: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
            label: 'Services',
          }),
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'ClusterTaskCount',
            dimensionsMap: { ClusterName: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
            label: 'Tasks',
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  getAlarmDefinitions(): AlarmDefinition[] {
    const { resourceName } = this.config;

    return [
      {
        metricName: 'ClusterCPUUtilization',
        namespace: 'ECS/ContainerInsights',
        dimensions: { ClusterName: resourceName },
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `ECS Cluster ${resourceName} CPU utilization is above 80%`,
      },
    ];
  }
}
