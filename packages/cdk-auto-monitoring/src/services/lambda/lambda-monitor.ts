import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface LambdaConfig extends BaseServiceConfig {
  function: lambda.IFunction;
}

/**
 * Lambda Function Monitor
 */
export class LambdaMonitor implements ServiceMonitor {
  private readonly config: LambdaConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: LambdaConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const functionName = this.config.resourceName;

    // Configure Lambda metrics
    this.metrics = [
      {
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensions: { FunctionName: functionName },
      },
      {
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensions: { FunctionName: functionName },
      },
      {
        namespace: 'AWS/Lambda',
        metricName: 'Throttles',
        dimensions: { FunctionName: functionName },
      },
      {
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensions: { FunctionName: functionName },
      },
      {
        namespace: 'AWS/Lambda',
        metricName: 'ConcurrentExecutions',
        dimensions: { FunctionName: functionName },
      },
      {
        namespace: 'AWS/Lambda',
        metricName: 'IteratorAge',
        dimensions: { FunctionName: functionName },
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
      // Invocations and Errors
      new cloudwatch.GraphWidget({
        title: `Lambda: ${resourceName} - Invocations & Errors`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Invocations',
            dimensionsMap: { FunctionName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Invocations',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: { FunctionName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Errors',
            color: cloudwatch.Color.RED,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Throttles',
            dimensionsMap: { FunctionName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Throttles',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Duration
      new cloudwatch.GraphWidget({
        title: `Lambda: ${resourceName} - Duration`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Duration',
            dimensionsMap: { FunctionName: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Avg Duration',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Duration',
            dimensionsMap: { FunctionName: resourceName },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Max Duration',
          }),
        ],
        width: 6,
        height: 6,
      }),

      // Concurrent Executions
      new cloudwatch.SingleValueWidget({
        title: `Lambda: ${resourceName} - Concurrent Executions`,
        metrics: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'ConcurrentExecutions',
            dimensionsMap: { FunctionName: resourceName },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(1),
            region,
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
        metricName: 'Errors',
        namespace: 'AWS/Lambda',
        dimensions: { FunctionName: resourceName },
        threshold: 5,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `Lambda function ${resourceName} has more than 5 errors`,
      },
      {
        metricName: 'Throttles',
        namespace: 'AWS/Lambda',
        dimensions: { FunctionName: resourceName },
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `Lambda function ${resourceName} is being throttled`,
      },
      {
        metricName: 'Duration',
        namespace: 'AWS/Lambda',
        dimensions: { FunctionName: resourceName },
        threshold: 25000, // 25 seconds
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.AVERAGE,
        period: cdk.Duration.minutes(5),
        alarmDescription: `Lambda function ${resourceName} average duration exceeds 25 seconds`,
      },
    ];
  }
}
