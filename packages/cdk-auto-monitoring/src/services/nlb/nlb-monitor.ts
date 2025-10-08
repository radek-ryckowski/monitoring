import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface NLBConfig extends BaseServiceConfig {
  loadBalancer: elbv2.INetworkLoadBalancer;
}

/**
 * Network Load Balancer Monitor
 */
export class NLBMonitor implements ServiceMonitor {
  private readonly config: NLBConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: NLBConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const lbName = this.config.resourceName;

    // Configure NLB metrics
    this.metrics = [
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'ActiveFlowCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'NewFlowCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'ProcessedBytes',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'TCP_Client_Reset_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'TCP_ELB_Reset_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'TCP_Target_Reset_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'HealthyHostCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/NetworkELB',
        metricName: 'UnHealthyHostCount',
        dimensions: { LoadBalancer: lbName },
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
      // Flow metrics
      new cloudwatch.GraphWidget({
        title: `NLB: ${resourceName} - Flow Metrics`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'ActiveFlowCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Active Flows',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'NewFlowCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'New Flows',
            color: cloudwatch.Color.BLUE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Processed bytes
      new cloudwatch.GraphWidget({
        title: `NLB: ${resourceName} - Throughput`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'ProcessedBytes',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Processed Bytes',
          }),
        ],
        width: 12,
        height: 6,
      }),

      // TCP resets
      new cloudwatch.GraphWidget({
        title: `NLB: ${resourceName} - TCP Resets`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'TCP_Client_Reset_Count',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Client Resets',
            color: cloudwatch.Color.ORANGE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'TCP_ELB_Reset_Count',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'ELB Resets',
            color: cloudwatch.Color.RED,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'TCP_Target_Reset_Count',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Target Resets',
            color: cloudwatch.Color.PURPLE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Target health
      new cloudwatch.GraphWidget({
        title: `NLB: ${resourceName} - Target Health`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'HealthyHostCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Healthy Targets',
            color: cloudwatch.Color.GREEN,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/NetworkELB',
            metricName: 'UnHealthyHostCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Unhealthy Targets',
            color: cloudwatch.Color.RED,
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
        metricName: 'UnHealthyHostCount',
        namespace: 'AWS/NetworkELB',
        dimensions: { LoadBalancer: resourceName },
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(1),
        alarmDescription: `NLB ${resourceName} has unhealthy targets`,
      },
      {
        metricName: 'TCP_ELB_Reset_Count',
        namespace: 'AWS/NetworkELB',
        dimensions: { LoadBalancer: resourceName },
        threshold: 100,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(1),
        alarmDescription: `NLB ${resourceName} is experiencing high TCP resets`,
      },
    ];
  }
}
