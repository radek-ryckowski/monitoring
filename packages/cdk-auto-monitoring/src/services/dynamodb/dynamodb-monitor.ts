import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface DynamoDBConfig extends BaseServiceConfig {
  table: dynamodb.ITable;
}

/**
 * DynamoDB Table Monitor
 */
export class DynamoDBMonitor implements ServiceMonitor {
  private readonly config: DynamoDBConfig;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: DynamoDBConfig) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const tableName = this.config.resourceName;

    // Configure DynamoDB metrics
    this.metrics = [
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedReadCapacityUnits',
        dimensions: { TableName: tableName },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedWriteCapacityUnits',
        dimensions: { TableName: tableName },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'UserErrors',
        dimensions: { TableName: tableName },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'SystemErrors',
        dimensions: { TableName: tableName },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'ConditionalCheckFailedRequests',
        dimensions: { TableName: tableName },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'ThrottledRequests',
        dimensions: { TableName: tableName },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'SuccessfulRequestLatency',
        dimensions: { TableName: tableName, Operation: 'GetItem' },
      },
      {
        namespace: 'AWS/DynamoDB',
        metricName: 'SuccessfulRequestLatency',
        dimensions: { TableName: tableName, Operation: 'PutItem' },
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
      // Capacity Units
      new cloudwatch.GraphWidget({
        title: `DynamoDB: ${resourceName} - Capacity Units`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedReadCapacityUnits',
            dimensionsMap: { TableName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Read Capacity',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedWriteCapacityUnits',
            dimensionsMap: { TableName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Write Capacity',
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Errors
      new cloudwatch.GraphWidget({
        title: `DynamoDB: ${resourceName} - Errors`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'UserErrors',
            dimensionsMap: { TableName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'User Errors',
            color: cloudwatch.Color.ORANGE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SystemErrors',
            dimensionsMap: { TableName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'System Errors',
            color: cloudwatch.Color.RED,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ThrottledRequests',
            dimensionsMap: { TableName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            region,
            label: 'Throttled',
            color: cloudwatch.Color.PURPLE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Latency
      new cloudwatch.GraphWidget({
        title: `DynamoDB: ${resourceName} - Latency`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: resourceName, Operation: 'GetItem' },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'GetItem Latency',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: resourceName, Operation: 'PutItem' },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            region,
            label: 'PutItem Latency',
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
        metricName: 'UserErrors',
        namespace: 'AWS/DynamoDB',
        dimensions: { TableName: resourceName },
        threshold: 5,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `DynamoDB table ${resourceName} has more than 5 user errors`,
      },
      {
        metricName: 'SystemErrors',
        namespace: 'AWS/DynamoDB',
        dimensions: { TableName: resourceName },
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `DynamoDB table ${resourceName} has system errors`,
      },
      {
        metricName: 'ThrottledRequests',
        namespace: 'AWS/DynamoDB',
        dimensions: { TableName: resourceName },
        threshold: 5,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `DynamoDB table ${resourceName} requests are being throttled`,
      },
    ];
  }
}
