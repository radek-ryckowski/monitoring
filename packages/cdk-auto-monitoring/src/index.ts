import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import {
  CloudWatchObservabilitySource,
  MetricConfiguration as OAMMetricConfiguration
} from '@monitoring/cdk-cloudwatch-observability';
import * as fs from 'fs';
import * as path from 'path';
import { BillingDashboard } from './billing';

// Import service monitors
import {
  ServiceMonitor,
  BaseServiceConfig,
  ECSServiceMonitor,
  ECSClusterMonitor,
  LambdaMonitor,
  RDSMonitor,
  DynamoDBMonitor,
  ALBMonitor,
  NLBMonitor,
  EC2Monitor,
  S3Monitor,
} from './services';

// Export billing module
export * from './billing';

/**
 * Widget configuration for custom metrics dashboard
 */
export interface CustomMetricWidget {
  /**
   * Widget title
   */
  readonly title?: string;

  /**
   * Widget type
   * @default 'line' - Line graph widget
   */
  readonly type?: 'line' | 'number' | 'gauge';

  /**
   * Widget width (1-24)
   * @default 12
   */
  readonly width?: number;

  /**
   * Widget height (1-24)
   * @default 6
   */
  readonly height?: number;

  /**
   * Statistic to use for the metric
   * @default 'Average'
   */
  readonly statistic?: string;

  /**
   * Period for the metric in seconds
   * @default 300 (5 minutes)
   */
  readonly period?: number;

  /**
   * Color for the metric line/value
   */
  readonly color?: string;

  /**
   * Label for the metric in the widget
   */
  readonly label?: string;

  /**
   * Whether to place this metric on the right Y-axis
   * @default false (left Y-axis)
   */
  readonly rightYAxis?: boolean;

  /**
   * Unit for the metric
   */
  readonly unit?: string;
}

/**
 * Configuration for custom metrics with dashboard widget support
 * Extends the OAM MetricConfiguration with dashboard-specific properties
 */
export interface MetricConfiguration extends OAMMetricConfiguration {
  /**
   * Dashboard widget configuration for this metric (optional)
   * If provided, a widget will be created for this metric in the dashboard
   */
  readonly widget?: CustomMetricWidget;
}

/**
 * Supported AWS service types for automatic monitoring
 */
export enum MonitoredServiceType {
  ECS_SERVICE = 'ECS_SERVICE',
  ECS_CLUSTER = 'ECS_CLUSTER',
  LAMBDA = 'LAMBDA',
  RDS = 'RDS',
  DYNAMODB = 'DYNAMODB',
  ALB = 'ALB',
  NLB = 'NLB',
  EC2 = 'EC2',
  S3 = 'S3'
}

/**
 * Configuration for a monitored resource
 */
export interface MonitoredResource {
  /**
   * The CDK resource to monitor
   */
  readonly resource: any;
  
  /**
   * Type of service
   */
  readonly type: MonitoredServiceType;
  
  /**
   * Custom name for the resource (optional)
   */
  readonly name?: string;
  
  /**
   * Additional custom metrics (optional)
   */
  readonly customMetrics?: MetricConfiguration[];
  
  /**
   * Whether to enable detailed monitoring
   * @default true
   */
  readonly detailedMonitoring?: boolean;
}

/**
 * Dashboard configuration
 */
export interface DashboardConfiguration {
  /**
   * Name of the dashboard
   */
  readonly dashboardName?: string;
  
  /**
   * Whether to create a dashboard
   * @default true
   */
  readonly createDashboard?: boolean;
  
  /**
   * Dashboard refresh interval in seconds
   * @default 60
   */
  readonly refreshInterval?: number;
  
  /**
   * Time range for dashboard widgets
   * @default '-PT3H' (last 3 hours)
   */
  readonly timeRange?: string;
}

/**
 * Properties for AutoMonitoring construct
 */
export interface AutoMonitoringProps {
  /**
   * Resources to monitor
   */
  readonly resources: MonitoredResource[];

  /**
   * CloudWatch Observability Source (optional)
   * If provided, metrics will be sent to cross-account monitoring
   */
  readonly observabilitySource?: CloudWatchObservabilitySource;

  /**
   * Sink ARN for creating observability source automatically
   * Alternative to providing observabilitySource
   */
  readonly sinkArn?: string;

  /**
   * Labels for observability source (if sinkArn is provided)
   */
  readonly labels?: { [key: string]: string };

  /**
   * Metric tags for observability source (if sinkArn is provided)
   */
  readonly metricTags?: { [key: string]: string };

  /**
   * Dashboard configuration
   */
  readonly dashboard?: DashboardConfiguration;

  /**
   * Application name
   */
  readonly applicationName: string;

  /**
   * Environment name
   */
  readonly environment: string;

  /**
   * Whether to create alarms automatically
   * @default false
   */
  readonly createAlarms?: boolean;

  /**
   * SNS topic ARN for alarm notifications
   */
  readonly alarmTopicArn?: string;

  /**
   * Path to billing dashboard configuration JSON file
   * When provided, automatically creates billing dashboards with custom config
   * @default - Creates default billing dashboard with $100 monthly budget
   */
  readonly billingConfigPath?: string;

  /**
   * Monthly budget amount in USD for default billing dashboard
   * Only used if billingConfigPath is not provided
   * @default 100
   */
  readonly monthlyBudget?: number;

  /**
   * Email address for budget notifications
   * Required if using default billing dashboard (no billingConfigPath)
   * Defaults to root account email if not provided
   */
  readonly budgetNotificationEmail?: string;

  /**
   * Disable billing dashboard entirely
   * @default false (billing dashboard enabled by default)
   */
  readonly disableBillingDashboard?: boolean;
}

/**
 * Metric definition with alarm thresholds
 */
interface MetricDefinition {
  namespace: string;
  metricName: string;
  dimensions: { [key: string]: string };
  statistic: cloudwatch.Statistic;
  period: cdk.Duration;
  label: string;
  alarmThreshold?: number;
  alarmComparisonOperator?: cloudwatch.ComparisonOperator;
  alarmEvaluationPeriods?: number;
}

/**
 * L3 Construct for Automatic CloudWatch Monitoring
 *
 * Automatically enables monitoring and creates dashboards for AWS resources
 */
export class AutoMonitoring extends Construct {
  /**
   * The created dashboard
   */
  public dashboard?: cloudwatch.Dashboard;

  /**
   * The billing dashboard
   */
  public billingDashboard?: BillingDashboard;

  /**
   * The observability source
   */
  public observabilitySource?: CloudWatchObservabilitySource;

  /**
   * All metric configurations
   */
  public readonly metricConfigurations: MetricConfiguration[] = [];

  /**
   * All created alarms
   */
  public readonly alarms: cloudwatch.Alarm[] = [];

  /**
   * Map of resources to their service monitors
   */
  private readonly serviceMonitors: Map<MonitoredResource, ServiceMonitor> = new Map();

  private readonly resources: MonitoredResource[];
  private readonly config: Required<DashboardConfiguration>;
  private readonly props: AutoMonitoringProps;

  constructor(scope: Construct, id: string, props: AutoMonitoringProps) {
    super(scope, id);
    
    this.props = props;
    this.resources = props.resources;
    
    // Set default dashboard configuration
    this.config = {
      dashboardName: props.dashboard?.dashboardName || `${props.applicationName}-${props.environment}`,
      createDashboard: props.dashboard?.createDashboard ?? true,
      refreshInterval: props.dashboard?.refreshInterval ?? 60,
      timeRange: props.dashboard?.timeRange ?? '-PT3H'
    };

    // Enable monitoring for all resources
    this.enableMonitoring();
    
    // Create or use observability source
    if (props.sinkArn) {
      this.observabilitySource = this.createObservabilitySource();
    } else if (props.observabilitySource) {
      this.observabilitySource = props.observabilitySource;
      this.addMetricsToSource();
    }
    
    // Create dashboard
    if (this.config.createDashboard) {
      this.dashboard = this.createDashboard();
    }

    // Create billing dashboard (enabled by default unless explicitly disabled)
    if (!props.disableBillingDashboard) {
      if (props.billingConfigPath) {
        // Use custom billing configuration from file
        this.createBillingDashboard(props.billingConfigPath);
      } else {
        // Create default billing dashboard with mandatory monthly budget
        this.createDefaultBillingDashboard();
      }
    }

    // Alarms are now created in enableMonitoring() method
  }

  /**
   * Create default billing dashboard with mandatory monthly budget
   */
  private createDefaultBillingDashboard(): void {
    // Get monthly budget (default $100 if not provided)
    const monthlyBudget = this.props.monthlyBudget || 100;

    // Get notification email (use provided email or construct a default)
    const accountId = cdk.Stack.of(this).account;
    const notificationEmail = this.props.budgetNotificationEmail || `billing-alerts+${accountId}@example.com`;

    // Log warning if using default email
    if (!this.props.budgetNotificationEmail) {
      new cdk.CfnOutput(this, 'BillingEmailWarning', {
        value: notificationEmail,
        description: 'WARNING: Using default email for billing alerts. Set budgetNotificationEmail in props.',
      });
    }

    // Extract monitored service names for billing
    const monitoredServices = this.getMonitoredServiceNames();

    // Create default billing configuration
    const defaultBillingConfig = {
      enabled: true,
      dashboardName: `${this.props.applicationName}-${this.props.environment}-Billing`,
      enableAnomalyDetection: true,
      enableForecasting: true,
      forecastDays: 30,
      trackedServices: monitoredServices.length > 0 ? monitoredServices : undefined,
      budgets: [
        {
          name: `${this.props.applicationName}-${this.props.environment}-MonthlyBudget`,
          amount: monthlyBudget,
          timeUnit: 'MONTHLY' as 'MONTHLY',
          thresholds: [80, 100],
          notificationEmails: [notificationEmail],
        },
      ],
    };

    this.billingDashboard = new BillingDashboard(this, 'BillingDashboard', {
      config: defaultBillingConfig,
      accountId,
      monitoredServices,
    });

    // Output budget information
    new cdk.CfnOutput(this, 'MonthlyBudget', {
      value: `$${monthlyBudget} USD`,
      description: 'Monthly budget configured for billing alerts',
    });
  }

  /**
   * Create billing dashboard from configuration file
   */
  private createBillingDashboard(configPath: string): void {
    const resolvedPath = path.resolve(configPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Billing configuration file not found: ${resolvedPath}`);
    }

    const configJson = fs.readFileSync(resolvedPath, 'utf-8');
    const billingConfig = JSON.parse(configJson);

    if (!billingConfig.enabled) {
      return;
    }

    // Extract monitored service names for billing
    const monitoredServices = this.getMonitoredServiceNames();

    this.billingDashboard = new BillingDashboard(this, 'BillingDashboard', {
      config: billingConfig,
      accountId: cdk.Stack.of(this).account,
      monitoredServices,
    });
  }

  /**
   * Get AWS service names from monitored resources
   */
  private getMonitoredServiceNames(): string[] {
    const serviceMap: { [key: string]: string } = {
      [MonitoredServiceType.EC2]: 'AmazonEC2',
      [MonitoredServiceType.LAMBDA]: 'AWSLambda',
      [MonitoredServiceType.RDS]: 'AmazonRDS',
      [MonitoredServiceType.DYNAMODB]: 'AmazonDynamoDB',
      [MonitoredServiceType.S3]: 'AmazonS3',
      [MonitoredServiceType.ECS_SERVICE]: 'AmazonECS',
      [MonitoredServiceType.ECS_CLUSTER]: 'AmazonECS',
      [MonitoredServiceType.ALB]: 'AmazonEC2', // ELB billing under EC2
      [MonitoredServiceType.NLB]: 'AmazonEC2',
    };

    const services = new Set<string>();
    for (const resource of this.resources) {
      const serviceName = serviceMap[resource.type];
      if (serviceName) {
        services.add(serviceName);
      }
    }

    return Array.from(services);
  }

  /**
   * Create appropriate service monitor for a resource
   */
  private createServiceMonitor(resource: MonitoredResource): ServiceMonitor | null {
    const baseConfig: BaseServiceConfig = {
      resourceName: resource.name || this.getResourceName(resource.resource),
      detailedMonitoring: resource.detailedMonitoring,
      customMetrics: resource.customMetrics as any,
      region: cdk.Stack.of(this).region,
    };

    switch (resource.type) {
      case MonitoredServiceType.ECS_SERVICE:
        const ecsService = resource.resource as ecs.FargateService | ecs.Ec2Service;
        return new ECSServiceMonitor(this, {
          ...baseConfig,
          service: ecsService,
          clusterName: ecsService.cluster.clusterName,
          enableContainerInsights: true,
        });

      case MonitoredServiceType.ECS_CLUSTER:
        return new ECSClusterMonitor(this, {
          ...baseConfig,
          cluster: resource.resource as ecs.ICluster,
          enableContainerInsights: true,
        });

      case MonitoredServiceType.LAMBDA:
        return new LambdaMonitor(this, {
          ...baseConfig,
          function: resource.resource as lambda.IFunction,
        });

      case MonitoredServiceType.RDS:
        return new RDSMonitor(this, {
          ...baseConfig,
          instance: resource.resource as rds.IDatabaseInstance,
        });

      case MonitoredServiceType.DYNAMODB:
        return new DynamoDBMonitor(this, {
          ...baseConfig,
          table: resource.resource as dynamodb.ITable,
        });

      case MonitoredServiceType.ALB:
        return new ALBMonitor(this, {
          ...baseConfig,
          loadBalancer: resource.resource as elbv2.IApplicationLoadBalancer,
        });

      case MonitoredServiceType.NLB:
        return new NLBMonitor(this, {
          ...baseConfig,
          loadBalancer: resource.resource as elbv2.INetworkLoadBalancer,
        });

      case MonitoredServiceType.EC2:
        return new EC2Monitor(this, {
          ...baseConfig,
          instance: resource.resource as ec2.IInstance,
        });

      case MonitoredServiceType.S3:
        return new S3Monitor(this, {
          ...baseConfig,
          bucket: resource.resource as s3.IBucket,
        });

      default:
        console.warn(`No service monitor for type: ${resource.type}`);
        return null;
    }
  }

  /**
   * Get resource name from CDK construct
   */
  private getResourceName(resource: any): string {
    if (resource.functionName) return resource.functionName;
    if (resource.serviceName) return resource.serviceName;
    if (resource.clusterName) return resource.clusterName;
    if (resource.instanceIdentifier) return resource.instanceIdentifier;
    if (resource.tableName) return resource.tableName;
    if (resource.loadBalancerName) return resource.loadBalancerName;
    if (resource.loadBalancerFullName) return resource.loadBalancerFullName;
    if (resource.bucketName) return resource.bucketName;
    if (resource.instanceId) return resource.instanceId;
    return resource.node?.id || 'unknown';
  }

  /**
   * Enable monitoring for all resources using service monitor pattern
   */
  private enableMonitoring(): void {
    for (const resource of this.resources) {
      // Create service monitor
      const monitor = this.createServiceMonitor(resource);
      if (!monitor) {
        console.warn(`Skipping monitoring for ${resource.type}`);
        continue;
      }

      // Enable monitoring
      monitor.enableMonitoring();

      // Store monitor
      this.serviceMonitors.set(resource, monitor);

      // Collect metrics
      const metrics = monitor.getMetricConfigurations();
      this.metricConfigurations.push(...metrics);

      // Create alarms if requested
      if (this.props.createAlarms && this.props.alarmTopicArn) {
        const alarmDefs = monitor.getAlarmDefinitions();
        for (const alarmDef of alarmDefs) {
          const alarm = new cloudwatch.Alarm(this, `Alarm-${resource.type}-${alarmDef.metricName}-${this.metricConfigurations.length}`, {
            metric: new cloudwatch.Metric({
              namespace: alarmDef.namespace,
              metricName: alarmDef.metricName,
              dimensionsMap: alarmDef.dimensions,
              statistic: alarmDef.statistic.toString(),
              period: alarmDef.period,
            }),
            threshold: alarmDef.threshold,
            comparisonOperator: alarmDef.comparisonOperator,
            evaluationPeriods: alarmDef.evaluationPeriods,
            alarmDescription: alarmDef.alarmDescription,
          });

          this.alarms.push(alarm);
        }
      }
    }
  }

  /**
   * Create dashboard with all metrics using service monitors
   */
  private createDashboard(): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: this.config.dashboardName,
      defaultInterval: cdk.Duration.seconds(this.config.refreshInterval)
    });

    // Get widgets from all service monitors
    for (const monitor of this.serviceMonitors.values()) {
      const widgets = monitor.createDashboardWidgets();
      if (widgets.length > 0) {
        dashboard.addWidgets(...widgets);
      }
    }

    // Add custom metric widgets
    const customWidgets = this.createCustomMetricWidgets();
    if (customWidgets.length > 0) {
      dashboard.addWidgets(...customWidgets);
    }

    return dashboard;
  }

  /**
   * Create observability source automatically
   */
  private createObservabilitySource(): CloudWatchObservabilitySource {
    if (!this.props.sinkArn) {
      throw new Error('sinkArn is required to create observability source');
    }

    const source = new CloudWatchObservabilitySource(this, 'ObservabilitySource', {
      linkName: `${this.props.applicationName}-${this.props.environment}-auto-monitoring`,
      sinkArn: this.props.sinkArn,
      labelTemplate: `\$AccountId-${this.props.applicationName}-${this.props.environment}`,
      tags: {
        ...this.props.labels,
        'Application': this.props.applicationName,
        'Environment': this.props.environment,
        'ManagedBy': 'AutoMonitoring',
        ...this.props.metricTags
      },
      metrics: this.metricConfigurations
    });

    return source;
  }

  /**
   * Add metrics to existing observability source
   */
  private addMetricsToSource(): void {
    if (!this.observabilitySource) {
      return;
    }

    for (const metric of this.metricConfigurations) {
      this.observabilitySource.addMetric(metric);
    }
  }

  /**
   * Create custom metric widgets from all resources
   */
  private createCustomMetricWidgets(): cloudwatch.IWidget[] {
    const widgets: cloudwatch.IWidget[] = [];
    
    // Group custom metrics by namespace for better organization
    const metricsByNamespace = new Map<string, MetricConfiguration[]>();
    
    for (const resource of this.resources) {
      if (resource.customMetrics) {
        for (const metric of resource.customMetrics) {
          if (metric.widget) {
            const metrics = metricsByNamespace.get(metric.namespace) || [];
            metrics.push(metric);
            metricsByNamespace.set(metric.namespace, metrics);
          }
        }
      }
    }

    // Create widgets for each namespace
    for (const [namespace, metrics] of metricsByNamespace) {
      // Group metrics by widget configuration to potentially combine them
      const widgetGroups = new Map<string, MetricConfiguration[]>();
      
      for (const metric of metrics) {
        const widgetKey = this.getWidgetKey(metric);
        const group = widgetGroups.get(widgetKey) || [];
        group.push(metric);
        widgetGroups.set(widgetKey, group);
      }

      // Create widgets for each group
      for (const [widgetKey, groupMetrics] of widgetGroups) {
        widgets.push(...this.createWidgetForMetrics(namespace, groupMetrics));
      }
    }

    return widgets;
  }

  /**
   * Generate a key for grouping metrics with similar widget configurations
   */
  private getWidgetKey(metric: MetricConfiguration): string {
    const widget = metric.widget!;
    return `${widget.type || 'line'}-${widget.width || 12}-${widget.height || 6}-${widget.title || 'Custom Metrics'}`;
  }

  /**
   * Create a widget for a group of metrics
   */
  private createWidgetForMetrics(namespace: string, metrics: MetricConfiguration[]): cloudwatch.IWidget[] {
    const widgets: cloudwatch.IWidget[] = [];
    const firstMetric = metrics[0];
    const widget = firstMetric.widget!;
    
    const title = widget.title || `${namespace} - Custom Metrics`;
    const width = widget.width || 12;
    const height = widget.height || 6;
    const type = widget.type || 'line';

    if (type === 'number') {
      // Create number widgets for each metric separately
      for (const metric of metrics) {
        const metricObj = new cloudwatch.Metric({
          namespace: metric.namespace,
          metricName: metric.metricName,
          dimensionsMap: metric.dimensions || {},
          statistic: metric.widget?.statistic || 'Average',
          period: cdk.Duration.seconds(metric.widget?.period || 300),
          label: metric.widget?.label || metric.metricName,
          unit: metric.widget?.unit ? cloudwatch.Unit[metric.widget.unit as keyof typeof cloudwatch.Unit] : undefined,
          color: metric.widget?.color
        });

        widgets.push(
          new cloudwatch.SingleValueWidget({
            title: metric.widget?.title || `${metric.metricName}`,
            metrics: [metricObj],
            width: width,
            height: height
          })
        );
      }
    } else if (type === 'gauge') {
      // Create gauge widgets for each metric separately  
      for (const metric of metrics) {
        const metricObj = new cloudwatch.Metric({
          namespace: metric.namespace,
          metricName: metric.metricName,
          dimensionsMap: metric.dimensions || {},
          statistic: metric.widget?.statistic || 'Average',
          period: cdk.Duration.seconds(metric.widget?.period || 300),
          label: metric.widget?.label || metric.metricName,
          unit: metric.widget?.unit ? cloudwatch.Unit[metric.widget.unit as keyof typeof cloudwatch.Unit] : undefined,
          color: metric.widget?.color
        });

        widgets.push(
          new cloudwatch.GaugeWidget({
            title: metric.widget?.title || `${metric.metricName}`,
            metrics: [metricObj],
            width: width,
            height: height
          })
        );
      }
    } else {
      // Create line graph widget, can combine multiple metrics
      const leftMetrics: cloudwatch.IMetric[] = [];
      const rightMetrics: cloudwatch.IMetric[] = [];

      for (const metric of metrics) {
        const metricObj = new cloudwatch.Metric({
          namespace: metric.namespace,
          metricName: metric.metricName,
          dimensionsMap: metric.dimensions || {},
          statistic: metric.widget?.statistic || 'Average',
          period: cdk.Duration.seconds(metric.widget?.period || 300),
          label: metric.widget?.label || metric.metricName,
          unit: metric.widget?.unit ? cloudwatch.Unit[metric.widget.unit as keyof typeof cloudwatch.Unit] : undefined,
          color: metric.widget?.color
        });

        if (metric.widget?.rightYAxis) {
          rightMetrics.push(metricObj);
        } else {
          leftMetrics.push(metricObj);
        }
      }

      widgets.push(
        new cloudwatch.GraphWidget({
          title: title,
          left: leftMetrics,
          right: rightMetrics,
          width: width,
          height: height
        })
      );
    }

    return widgets;
  }

  /**
   * Get dashboard URL
   */
  public getDashboardUrl(): string {
    const region = cdk.Stack.of(this).region;
    const dashboardName = this.config.dashboardName;
    return `https://console.aws.amazon.com/cloudwatch/home?region=${region}#dashboards:name=${dashboardName}`;
  }
}
