import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AutoMonitoring, MonitoredServiceType } from '@monitoring/cdk-auto-monitoring';
import { CloudWatchObservabilityTarget, CloudWatchAdotMonitoringStack } from '@monitoring/cdk-cloudwatch-observability';

export interface ExampleStackProps extends cdk.StackProps {
  sinkArn?: string;
  enableAlarms?: boolean;
  alarmTopicArn?: string;
}

/**
 * Scenario 1: Minimal Monitoring (ECS + Lambda)
 * Simple monitoring setup with basic services
 */
export class Scenario1MinimalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ExampleStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });
    taskDefinition.addContainer('app', {
      image: ecs.ContainerImage.fromRegistry('nginx'),
      memoryLimitMiB: 512
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100
    });

    const func = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200, body: "Hello" });')
    });

    new AutoMonitoring(this, 'AutoMonitoring', {
      applicationName: 'Scenario1',
      environment: 'Test',
      resources: [
        { resource: service, type: MonitoredServiceType.ECS_SERVICE },
        { resource: func, type: MonitoredServiceType.LAMBDA }
      ]
    });

    new cdk.CfnOutput(this, 'Scenario', { value: '1-Minimal: ECS + Lambda' });
    new cdk.CfnOutput(this, 'LambdaFunctionName', { value: func.functionName });
    new cdk.CfnOutput(this, 'LambdaFunctionArn', { value: func.functionArn });
    new cdk.CfnOutput(this, 'ECSClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ECSServiceName', { value: service.serviceName });
  }
}

/**
 * Scenario 2: Cross-Account Monitoring (ECS + DynamoDB)
 * Source account sending metrics to monitoring account
 */
export class Scenario2CrossAccountStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ExampleStackProps) {
    super(scope, id, props);

    if (!props.sinkArn) {
      throw new Error('Scenario 2 requires sinkArn');
    }

    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });
    taskDefinition.addContainer('web', {
      image: ecs.ContainerImage.fromRegistry('nginx'),
      memoryLimitMiB: 512,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web' })
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1
    });

    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    new AutoMonitoring(this, 'AutoMonitoring', {
      applicationName: 'Scenario2',
      environment: 'Test',
      sinkArn: props.sinkArn,
      labels: { 'Team': 'Platform', 'Scenario': '2' },
      metricTags: { 'CrossAccount': 'true' },
      resources: [
        { resource: service, type: MonitoredServiceType.ECS_SERVICE, name: 'web-service' },
        { resource: table, type: MonitoredServiceType.DYNAMODB }
      ]
    });

    new cdk.CfnOutput(this, 'Scenario', { value: '2-CrossAccount: ECS + DynamoDB with sink' });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}

/**
 * Scenario 3: Full Stack (ALB + ECS + Lambda + RDS + DynamoDB)
 * Complete application stack monitoring
 */
export class Scenario3FullStackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ExampleStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });
    taskDefinition.addContainer('app', {
      image: ecs.ContainerImage.fromRegistry('nginx'),
      memoryLimitMiB: 512,
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app' })
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1
    });

    const apiFunction = new lambda.Function(this, 'APIFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200, body: "API" });'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30)
    });

    const workerFunction = new lambda.Function(this, 'WorkerFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline('def handler(event, context):\n    return {"statusCode": 200}'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5)
    });

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15
      }),
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20
    });

    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    const monitoring = new AutoMonitoring(this, 'FullStackMonitoring', {
      applicationName: 'Scenario3',
      environment: 'Test',
      sinkArn: props?.sinkArn,
      resources: [
        { resource: alb, type: MonitoredServiceType.ALB, name: 'main-alb' },
        { resource: service, type: MonitoredServiceType.ECS_SERVICE, name: 'app-service', detailedMonitoring: true },
        { resource: apiFunction, type: MonitoredServiceType.LAMBDA, name: 'api-function' },
        { resource: workerFunction, type: MonitoredServiceType.LAMBDA, name: 'worker-function' },
        { resource: database, type: MonitoredServiceType.RDS, name: 'postgres-db', detailedMonitoring: true },
        { resource: table, type: MonitoredServiceType.DYNAMODB, name: 'data-table' }
      ],
      createAlarms: props?.enableAlarms,
      alarmTopicArn: props?.alarmTopicArn,
      dashboard: {
        dashboardName: 'Scenario3-FullStack',
        refreshInterval: 30,
        timeRange: '-PT6H'
      }
    });

    new cdk.CfnOutput(this, 'Scenario', { value: '3-FullStack: ALB + ECS + Lambda + RDS + DynamoDB' });
    new cdk.CfnOutput(this, 'DashboardURL', { value: monitoring.getDashboardUrl() });
    new cdk.CfnOutput(this, 'ALBDNSName', { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'APIFunctionName', { value: apiFunction.functionName });
    new cdk.CfnOutput(this, 'APIFunctionArn', { value: apiFunction.functionArn });
    new cdk.CfnOutput(this, 'WorkerFunctionName', { value: workerFunction.functionName });
    new cdk.CfnOutput(this, 'WorkerFunctionArn', { value: workerFunction.functionArn });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}

/**
 * Scenario 4: Custom Metrics (ECS with custom business metrics)
 * Application metrics alongside infrastructure metrics
 */
export class Scenario4CustomMetricsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ExampleStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });
    taskDefinition.addContainer('app', {
      image: ecs.ContainerImage.fromRegistry('nginx'),
      memoryLimitMiB: 512
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100
    });

    new AutoMonitoring(this, 'Monitoring', {
      applicationName: 'Scenario4',
      environment: 'Test',
      sinkArn: props?.sinkArn,
      resources: [
        {
          resource: service,
          type: MonitoredServiceType.ECS_SERVICE,
          customMetrics: [
            { 
              namespace: 'Scenario4/API', 
              metricName: 'RequestCount',
              widget: {
                title: 'API Request Count',
                type: 'line',
                statistic: 'Sum',
                period: 300,
                label: 'Requests/5min',
                color: '#1f77b4'
              }
            },
            { 
              namespace: 'Scenario4/API', 
              metricName: 'ResponseTime',
              widget: {
                title: 'API Response Time',
                type: 'line',
                statistic: 'Average',
                period: 300,
                label: 'Avg Response Time (ms)',
                color: '#ff7f0e',
                rightYAxis: true
              }
            },
            { 
              namespace: 'Scenario4/API', 
              metricName: 'ErrorRate',
              widget: {
                title: 'API Error Rate',
                type: 'line',
                statistic: 'Average',
                period: 300,
                label: 'Error Rate (%)',
                color: '#d62728'
              }
            },
            { 
              namespace: 'Scenario4/Business', 
              metricName: 'OrdersProcessed',
              widget: {
                title: 'Orders Processed',
                type: 'number',
                statistic: 'Sum',
                period: 3600,
                label: 'Orders/Hour',
                width: 6
              }
            },
            { 
              namespace: 'Scenario4/Business', 
              metricName: 'Revenue', 
              dimensions: { Currency: 'USD' },
              widget: {
                title: 'Revenue (USD)',
                type: 'gauge',
                statistic: 'Sum',
                period: 3600,
                label: 'Revenue/Hour',
                width: 6,
                unit: 'Count/Second'
              }
            }
          ]
        }
      ]
    });

    new cdk.CfnOutput(this, 'Scenario', { value: '4-CustomMetrics: ECS with business metrics' });
    new cdk.CfnOutput(this, 'ECSClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ECSServiceName', { value: service.serviceName });
  }
}

/**
 * Scenario 5: Multi-Service (S3 + Lambda + EC2)
 * Diverse service types monitoring
 */
export class Scenario5MultiServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ExampleStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });

    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const func = new lambda.Function(this, 'ProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 }; }'),
      memorySize: 256
    });

    const instance = new ec2.Instance(this, 'Instance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      detailedMonitoring: true
    });

    new AutoMonitoring(this, 'Monitoring', {
      applicationName: 'Scenario5',
      environment: 'Test',
      sinkArn: props?.sinkArn,
      resources: [
        { resource: bucket, type: MonitoredServiceType.S3 },
        { resource: func, type: MonitoredServiceType.LAMBDA },
        { resource: instance, type: MonitoredServiceType.EC2 }
      ]
    });

    new cdk.CfnOutput(this, 'Scenario', { value: '5-MultiService: S3 + Lambda + EC2' });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'LambdaFunctionName', { value: func.functionName });
    new cdk.CfnOutput(this, 'LambdaFunctionArn', { value: func.functionArn });
    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
  }
}

/**
 * Scenario 6: Minimal with Cross-Account (ECS + Lambda)
 * Same as Scenario 1 but with cross-account monitoring enabled
 */
export class Scenario6MinimalCrossAccountStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ExampleStackProps) {
    super(scope, id, props);

    if (!props.sinkArn) {
      throw new Error('Scenario 6 requires sinkArn for cross-account monitoring');
    }

    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });
    taskDefinition.addContainer('app', {
      image: ecs.ContainerImage.fromRegistry('nginx'),
      memoryLimitMiB: 512,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app' })
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100
    });

    const func = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Processing request:', JSON.stringify(event));
          return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Hello from Scenario 6', timestamp: Date.now() })
          };
        };
      `),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Scenario 6 - Lambda function with cross-account monitoring'
    });

    // Auto-monitoring with cross-account sink
    new AutoMonitoring(this, 'AutoMonitoring', {
      applicationName: 'Scenario6',
      environment: 'Test',
      sinkArn: props.sinkArn,
      resources: [
        { resource: service, type: MonitoredServiceType.ECS_SERVICE },
        { resource: func, type: MonitoredServiceType.LAMBDA }
      ]
    });

    new cdk.CfnOutput(this, 'Scenario', {
      value: '6-MinimalCrossAccount: ECS + Lambda with OAM',
      description: 'Scenario type and services'
    });
    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: func.functionName,
      description: 'Lambda function name for testing'
    });
    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: func.functionArn,
      description: 'Lambda function ARN'
    });
    new cdk.CfnOutput(this, 'ECSClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name'
    });
    new cdk.CfnOutput(this, 'ECSServiceName', {
      value: service.serviceName,
      description: 'ECS service name'
    });
  }
}

export interface MonitoringAccountStackProps extends cdk.StackProps {
  /**
   * CloudWatch namespaces to scrape with ADOT (e.g., ['AWS/EC2', 'AWS/RDS'])
   * If provided, enables ADOT Collector with Prometheus and Grafana
   * @default - ADOT not deployed
   */
  cloudWatchNamespaces?: string[];

  /**
   * Enable Container Insights for the ECS cluster
   * @default true
   */
  enableContainerInsights?: boolean;

  /**
   * Grafana admin password
   * @default - Auto-generated password
   */
  grafanaAdminPassword?: string;
}

/**
 * Monitoring Account Target Stack
 * Deploys the OAM sink for receiving metrics from source accounts
 * Optionally deploys ADOT Collector with Prometheus and Grafana
 */
export class MonitoringAccountStack extends cdk.Stack {
  public readonly sinkArn: string;
  public readonly target: CloudWatchObservabilityTarget;
  public readonly adotStack?: CloudWatchAdotMonitoringStack;

  constructor(scope: Construct, id: string, sourceAccountIds: string[], props?: MonitoringAccountStackProps) {
    super(scope, id, props);

    const target = new CloudWatchObservabilityTarget(this, 'ObservabilitySink', {
      sinkName: 'central-monitoring-sink',
      sourceAccountIds: sourceAccountIds,
    });

    this.sinkArn = target.sinkArn;
    this.target = target;

    // Deploy ADOT monitoring stack if namespaces are provided
    if (props?.cloudWatchNamespaces && props.cloudWatchNamespaces.length > 0) {
      this.adotStack = new CloudWatchAdotMonitoringStack(this, 'AdotMonitoring', {
        cloudWatchSourceAccountId: cdk.Stack.of(this).account,
        cloudWatchNamespaces: props.cloudWatchNamespaces,
        grafanaAdminPassword: props.grafanaAdminPassword,
        enableContainerInsights: props.enableContainerInsights,
      });
    }

    // Main outputs
    new cdk.CfnOutput(this, 'SinkArn', {
      value: this.sinkArn,
      description: '⚠️  IMPORTANT: Use this Sink ARN in source account deployments',
      exportName: 'MonitoringSinkArn'
    });

    // CloudWatch Console URLs
    new cdk.CfnOutput(this, 'CloudWatchDashboards', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:`,
      description: 'View CloudWatch Dashboards'
    });

    new cdk.CfnOutput(this, 'CloudWatchMetrics', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#metricsV2:`,
      description: 'Explore CloudWatch Metrics'
    });

    new cdk.CfnOutput(this, 'CloudWatchLogs', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#logsV2:log-groups`,
      description: 'View CloudWatch Logs'
    });

    new cdk.CfnOutput(this, 'OAMConsole', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#observability-access-manager:`,
      description: 'Manage Cross-Account Observability'
    });

    // ADOT-specific outputs (only if ADOT is enabled)
    if (this.adotStack) {
      new cdk.CfnOutput(this, 'ADOTCollectorConsole', {
        value: `https://console.aws.amazon.com/ecs/v2/clusters/${this.adotStack.cluster.clusterName}/services/${this.adotStack.adotService.serviceName}/health?region=${this.region}`,
        description: 'ADOT Collector ECS Service'
      });

      new cdk.CfnOutput(this, 'PrometheusConsole', {
        value: `https://console.aws.amazon.com/ecs/v2/clusters/${this.adotStack.cluster.clusterName}/services/${this.adotStack.prometheusService.serviceName}/health?region=${this.region}`,
        description: 'Prometheus ECS Service'
      });

      new cdk.CfnOutput(this, 'GrafanaURL', {
        value: this.adotStack.grafanaUrl,
        description: 'Grafana Dashboard URL'
      });

      new cdk.CfnOutput(this, 'GrafanaConsole', {
        value: `https://console.aws.amazon.com/ecs/v2/clusters/${this.adotStack.cluster.clusterName}/services/${this.adotStack.grafanaService.serviceName}/health?region=${this.region}`,
        description: 'Grafana ECS Service'
      });
    }

    // Summary
    const enabledFeatures = ['CloudWatch OAM'];
    if (this.adotStack) {
      enabledFeatures.push('ADOT Collector', 'Prometheus', 'Grafana');
    }

    new cdk.CfnOutput(this, 'MonitoringFeatures', {
      value: enabledFeatures.join(', '),
      description: 'Enabled monitoring features'
    });
  }
}
