import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface ALBConfig extends BaseServiceConfig {
  loadBalancer: elbv2.IApplicationLoadBalancer;
}

/**
 * Application Load Balancer Monitor
 */
export class ALBMonitor implements ServiceMonitor {
  private readonly config: ALBConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: ALBConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const lbName = this.config.resourceName;

    // Configure ALB metrics
    this.metrics = [
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_2XX_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_4XX_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_ELB_4XX_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_ELB_5XX_Count',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetConnectionErrorCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'RejectedConnectionCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'ActiveConnectionCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
        metricName: 'HealthyHostCount',
        dimensions: { LoadBalancer: lbName },
      },
      {
        namespace: 'AWS/ApplicationELB',
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
      // Request count and response time
      new cloudwatch.GraphWidget({
        title: `ALB: ${resourceName} - Requests & Response Time`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Requests',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetResponseTime',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Response Time (avg)',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // HTTP status codes
      new cloudwatch.GraphWidget({
        title: `ALB: ${resourceName} - HTTP Status Codes`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_2XX_Count',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: '2XX Success',
            color: cloudwatch.Color.GREEN,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_4XX_Count',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: '4XX Client Errors',
            color: cloudwatch.Color.ORANGE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: '5XX Server Errors',
            color: cloudwatch.Color.RED,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Connection metrics
      new cloudwatch.GraphWidget({
        title: `ALB: ${resourceName} - Connections`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'ActiveConnectionCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Active Connections',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RejectedConnectionCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Rejected Connections',
            color: cloudwatch.Color.RED,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetConnectionErrorCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Target Connection Errors',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Target health
      new cloudwatch.GraphWidget({
        title: `ALB: ${resourceName} - Target Health`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HealthyHostCount',
            dimensionsMap: { LoadBalancer: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Healthy Targets',
            color: cloudwatch.Color.GREEN,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
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
        metricName: 'HTTPCode_Target_5XX_Count',
        namespace: 'AWS/ApplicationELB',
        dimensions: { LoadBalancer: resourceName },
        threshold: 10,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(1),
        alarmDescription: `ALB ${resourceName} is experiencing high 5XX errors`,
      },
      {
        metricName: 'UnHealthyHostCount',
        namespace: 'AWS/ApplicationELB',
        dimensions: { LoadBalancer: resourceName },
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(1),
        alarmDescription: `ALB ${resourceName} has unhealthy targets`,
      },
      {
        metricName: 'TargetResponseTime',
        namespace: 'AWS/ApplicationELB',
        dimensions: { LoadBalancer: resourceName },
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 3,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(1),
        alarmDescription: `ALB ${resourceName} response time is high`,
      },
    ];
  }
}
