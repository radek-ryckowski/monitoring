import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { ServiceMonitor, AlarmDefinition, BaseServiceConfig, MetricConfiguration } from '../base-service-monitor';

export interface S3Config extends BaseServiceConfig {
  bucket: s3.IBucket;
}

/**
 * S3 Bucket Monitor
 */
export class S3Monitor implements ServiceMonitor {
  private readonly config: S3Config;
  private readonly scope: Construct;
  private metrics: MetricConfiguration[] = [];

  constructor(scope: Construct, config: S3Config) {
    this.scope = scope;
    this.config = config;
  }

  enableMonitoring(): void {
    const bucketName = this.config.resourceName;

    // Configure S3 metrics (request metrics must be enabled on bucket)
    this.metrics = [
      {
        namespace: 'AWS/S3',
        metricName: 'BucketSizeBytes',
        dimensions: {
          BucketName: bucketName,
          StorageType: 'StandardStorage',
        },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'NumberOfObjects',
        dimensions: {
          BucketName: bucketName,
          StorageType: 'AllStorageTypes',
        },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'AllRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'GetRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'PutRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'DeleteRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'HeadRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'PostRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'ListRequests',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'BytesDownloaded',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'BytesUploaded',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: '4xxErrors',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: '5xxErrors',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'FirstByteLatency',
        dimensions: { BucketName: bucketName },
      },
      {
        namespace: 'AWS/S3',
        metricName: 'TotalRequestLatency',
        dimensions: { BucketName: bucketName },
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
      // Bucket size and object count
      new cloudwatch.GraphWidget({
        title: `S3: ${resourceName} - Storage`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'BucketSizeBytes',
            dimensionsMap: {
              BucketName: resourceName,
              StorageType: 'StandardStorage',
            },
            statistic: 'Average',
            period: cdk.Duration.days(1),
            region,
            label: 'Bucket Size (bytes)',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'NumberOfObjects',
            dimensionsMap: {
              BucketName: resourceName,
              StorageType: 'AllStorageTypes',
            },
            statistic: 'Average',
            period: cdk.Duration.days(1),
            region,
            label: 'Object Count',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Request metrics
      new cloudwatch.GraphWidget({
        title: `S3: ${resourceName} - Requests`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'AllRequests',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: 'All Requests',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'GetRequests',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: 'GET Requests',
            color: cloudwatch.Color.BLUE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'PutRequests',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: 'PUT Requests',
            color: cloudwatch.Color.GREEN,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Data transfer
      new cloudwatch.GraphWidget({
        title: `S3: ${resourceName} - Data Transfer`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'BytesDownloaded',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: 'Bytes Downloaded',
            color: cloudwatch.Color.BLUE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'BytesUploaded',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: 'Bytes Uploaded',
            color: cloudwatch.Color.GREEN,
          }),
        ],
        width: 12,
        height: 6,
      }),

      // Errors and latency
      new cloudwatch.GraphWidget({
        title: `S3: ${resourceName} - Errors & Latency`,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: '4xxErrors',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: '4xx Errors',
            color: cloudwatch.Color.ORANGE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: '5xxErrors',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            region,
            label: '5xx Errors',
            color: cloudwatch.Color.RED,
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'FirstByteLatency',
            dimensionsMap: { BucketName: resourceName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            region,
            label: 'First Byte Latency (ms)',
            color: cloudwatch.Color.PURPLE,
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
        metricName: '5xxErrors',
        namespace: 'AWS/S3',
        dimensions: { BucketName: resourceName },
        threshold: 10,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `S3 bucket ${resourceName} is experiencing 5xx errors`,
      },
      {
        metricName: '4xxErrors',
        namespace: 'AWS/S3',
        dimensions: { BucketName: resourceName },
        threshold: 50,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        statistic: cloudwatch.Statistic.SUM,
        period: cdk.Duration.minutes(5),
        alarmDescription: `S3 bucket ${resourceName} is experiencing high 4xx errors`,
      },
    ];
  }
}
