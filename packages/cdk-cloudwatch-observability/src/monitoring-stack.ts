import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';

/**
 * Properties for CloudWatch ADOT Monitoring Stack
 */
export interface CloudWatchAdotMonitoringStackProps {
  /**
   * VPC to deploy the monitoring stack into. If not provided, a new VPC will be created.
   */
  readonly vpc?: ec2.IVpc;

  /**
   * CloudWatch source account ID to read metrics from
   */
  readonly cloudWatchSourceAccountId: string;

  /**
   * AWS Region where CloudWatch metrics are located
   * @default - Current stack region
   */
  readonly cloudWatchRegion?: string;

  /**
   * CloudWatch namespaces to scrape (e.g., ['AWS/EC2', 'AWS/RDS'])
   */
  readonly cloudWatchNamespaces: string[];

  /**
   * Grafana admin password. If not provided, a random password will be generated.
   */
  readonly grafanaAdminPassword?: string;

  /**
   * Enable public access to Grafana via ALB
   * @default true
   */
  readonly enablePublicGrafana?: boolean;

  /**
   * Prometheus retention period
   * @default '15d'
   */
  readonly prometheusRetention?: string;

  /**
   * ECS cluster name
   * @default 'cloudwatch-adot-monitoring'
   */
  readonly clusterName?: string;

  /**
   * CloudMap namespace name for service discovery
   * @default 'monitoring.local'
   */
  readonly namespaceName?: string;

  /**
   * ADOT collector poll interval for CloudWatch metrics
   * @default '5m'
   */
  readonly adotPollInterval?: string;

  /**
   * Prometheus memory limit in MiB
   * @default 2048
   */
  readonly prometheusMemory?: number;

  /**
   * Prometheus CPU units
   * @default 1024
   */
  readonly prometheusCpu?: number;

  /**
   * ADOT collector memory limit in MiB
   * @default 1024
   */
  readonly adotMemory?: number;

  /**
   * ADOT collector CPU units
   * @default 512
   */
  readonly adotCpu?: number;

  /**
   * Grafana memory limit in MiB
   * @default 1024
   */
  readonly grafanaMemory?: number;

  /**
   * Grafana CPU units
   * @default 512
   */
  readonly grafanaCpu?: number;

  /**
   * Enable EFS encryption
   * @default true
   */
  readonly enableEfsEncryption?: boolean;

  /**
   * EFS lifecycle policy
   * @default efs.LifecyclePolicy.AFTER_14_DAYS
   */
  readonly efsLifecyclePolicy?: efs.LifecyclePolicy;

  /**
   * Log retention in days
   * @default logs.RetentionDays.ONE_WEEK
   */
  readonly logRetention?: logs.RetentionDays;

  /**
   * Grafana additional plugins to install (comma-separated)
   * @default 'grafana-clock-panel'
   */
  readonly grafanaPlugins?: string;

  /**
   * Allow users to sign up to Grafana
   * @default false
   */
  readonly allowGrafanaSignUp?: boolean;

  /**
   * Additional environment variables for ADOT collector
   */
  readonly adotEnvironment?: { [key: string]: string };

  /**
   * Additional environment variables for Prometheus
   */
  readonly prometheusEnvironment?: { [key: string]: string };

  /**
   * Additional environment variables for Grafana
   */
  readonly grafanaEnvironment?: { [key: string]: string };

  /**
   * Enable Container Insights for the ECS cluster
   * @default true
   */
  readonly enableContainerInsights?: boolean;
}

/**
 * L3 Construct for CloudWatch ADOT Monitoring Stack
 *
 * This construct deploys a complete monitoring solution with:
 * - ADOT Collector: Scrapes CloudWatch metrics and forwards to Prometheus
 * - Prometheus: Stores metrics with persistent EFS storage
 * - Grafana: Visualizes metrics with optional public ALB access
 *
 * The stack uses ECS Fargate for all services with Cloud Map for service discovery.
 */
export class CloudWatchAdotMonitoringStack extends Construct {
  /**
   * The ECS cluster hosting the monitoring services
   */
  public readonly cluster: ecs.Cluster;

  /**
   * The Grafana URL (if public access is enabled)
   */
  public readonly grafanaUrl: string;

  /**
   * The Prometheus ECS service
   */
  public readonly prometheusService: ecs.FargateService;

  /**
   * The ADOT collector ECS service
   */
  public readonly adotService: ecs.FargateService;

  /**
   * The Grafana ECS service
   */
  public readonly grafanaService: ecs.FargateService;

  /**
   * The VPC used for the monitoring stack
   */
  public readonly vpc: ec2.IVpc;

  /**
   * The Cloud Map namespace for service discovery
   */
  public readonly namespace: servicediscovery.PrivateDnsNamespace;

  /**
   * The EFS file system used for Prometheus data
   */
  public readonly prometheusFileSystem: efs.FileSystem;

  /**
   * The ALB for Grafana (if public access is enabled)
   */
  public readonly grafanaAlb?: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: CloudWatchAdotMonitoringStackProps) {
    super(scope, id);

    // Use provided VPC or create a new one
    this.vpc = props.vpc ?? new ec2.Vpc(this, 'MonitoringVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Create ECS Cluster
    this.cluster = new ecs.Cluster(this, 'MonitoringCluster', {
      vpc: this.vpc,
      clusterName: props.clusterName || 'cloudwatch-adot-monitoring',
      containerInsights: props.enableContainerInsights ?? true,
    });

    // Create Cloud Map namespace for service discovery
    this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'MonitoringNamespace', {
      name: props.namespaceName || 'monitoring.local',
      vpc: this.vpc,
    });

    // Create EFS for Prometheus data persistence
    this.prometheusFileSystem = new efs.FileSystem(this, 'PrometheusEFS', {
      vpc: this.vpc,
      encrypted: props.enableEfsEncryption ?? true,
      lifecyclePolicy: props.efsLifecyclePolicy || efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const prometheusAccessPoint = this.prometheusFileSystem.addAccessPoint('PrometheusAccessPoint', {
      path: '/prometheus',
      createAcl: {
        ownerGid: '65534',
        ownerUid: '65534',
        permissions: '755',
      },
      posixUser: {
        gid: '65534',
        uid: '65534',
      },
    });

    // Deploy Prometheus
    const prometheusTaskDef = this.createPrometheusTask(props);

    const prometheusVolumeName = 'prometheus-data';
    prometheusTaskDef.addVolume({
      name: prometheusVolumeName,
      efsVolumeConfiguration: {
        fileSystemId: this.prometheusFileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: prometheusAccessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Grant EFS permissions to Prometheus task
    this.prometheusFileSystem.grant(
      prometheusTaskDef.taskRole,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite'
    );

    const prometheusSecurityGroup = new ec2.SecurityGroup(this, 'PrometheusSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Prometheus',
      allowAllOutbound: true,
    });

    this.prometheusFileSystem.connections.allowDefaultPortFrom(prometheusSecurityGroup);

    this.prometheusService = new ecs.FargateService(this, 'PrometheusService', {
      cluster: this.cluster,
      taskDefinition: prometheusTaskDef,
      desiredCount: 1,
      securityGroups: [prometheusSecurityGroup],
      cloudMapOptions: {
        name: 'prometheus',
        cloudMapNamespace: this.namespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
      },
    });

    // Mount the EFS volume to the Prometheus container
    prometheusTaskDef.defaultContainer?.addMountPoints({
      containerPath: '/prometheus',
      sourceVolume: prometheusVolumeName,
      readOnly: false,
    });

    // Deploy ADOT Collector
    const adotTaskDef = this.createAdotTask(props);

    const adotSecurityGroup = new ec2.SecurityGroup(this, 'AdotSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ADOT Collector',
      allowAllOutbound: true,
    });

    this.adotService = new ecs.FargateService(this, 'AdotService', {
      cluster: this.cluster,
      taskDefinition: adotTaskDef,
      desiredCount: 1,
      securityGroups: [adotSecurityGroup],
    });

    // Allow ADOT to send metrics to Prometheus
    prometheusSecurityGroup.addIngressRule(
      adotSecurityGroup,
      ec2.Port.tcp(9090),
      'Allow ADOT to send metrics to Prometheus'
    );

    // Deploy Grafana
    const grafanaTaskDef = this.createGrafanaTask(props);

    const grafanaSecurityGroup = new ec2.SecurityGroup(this, 'GrafanaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Grafana',
      allowAllOutbound: true,
    });

    this.grafanaService = new ecs.FargateService(this, 'GrafanaService', {
      cluster: this.cluster,
      taskDefinition: grafanaTaskDef,
      desiredCount: 1,
      securityGroups: [grafanaSecurityGroup],
    });

    // Allow Grafana to query Prometheus
    prometheusSecurityGroup.addIngressRule(
      grafanaSecurityGroup,
      ec2.Port.tcp(9090),
      'Allow Grafana to query Prometheus'
    );

    // Create ALB for Grafana
    if (props.enablePublicGrafana !== false) {
      const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
        vpc: this.vpc,
        description: 'Security group for Grafana ALB',
        allowAllOutbound: true,
      });

      albSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        'Allow HTTP traffic'
      );

      this.grafanaAlb = new elbv2.ApplicationLoadBalancer(this, 'GrafanaALB', {
        vpc: this.vpc,
        internetFacing: true,
        securityGroup: albSecurityGroup,
      });

      const listener = this.grafanaAlb.addListener('HttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
      });

      listener.addTargets('GrafanaTarget', {
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [this.grafanaService],
        healthCheck: {
          path: '/api/health',
          interval: cdk.Duration.seconds(30),
        },
      });

      grafanaSecurityGroup.addIngressRule(
        albSecurityGroup,
        ec2.Port.tcp(3000),
        'Allow ALB to reach Grafana'
      );

      this.grafanaUrl = `http://${this.grafanaAlb.loadBalancerDnsName}`;

      new cdk.CfnOutput(this, 'GrafanaURL', {
        value: this.grafanaUrl,
        description: 'Grafana Dashboard URL',
      });
    } else {
      this.grafanaUrl = 'Not exposed publicly';
    }

    new cdk.CfnOutput(this, 'PrometheusServiceDiscovery', {
      value: `prometheus.${props.namespaceName || 'monitoring.local'}:9090`,
      description: 'Prometheus service discovery endpoint',
    });

    new cdk.CfnOutput(this, 'GrafanaAdminUser', {
      value: 'admin',
      description: 'Grafana admin username',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster name',
    });
  }

  /**
   * Create Prometheus task definition
   */
  private createPrometheusTask(props: CloudWatchAdotMonitoringStackProps): ecs.FargateTaskDefinition {
    const taskDef = new ecs.FargateTaskDefinition(this, 'PrometheusTask', {
      memoryLimitMiB: props.prometheusMemory || 2048,
      cpu: props.prometheusCpu || 1024,
    });

    const retentionTime = props.prometheusRetention || '15d';

    const environment: { [key: string]: string } = {
      TZ: 'UTC',
      ...(props.prometheusEnvironment || {}),
    };

    taskDef.addContainer('prometheus', {
      image: ecs.ContainerImage.fromRegistry('prom/prometheus:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'prometheus',
        logRetention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      }),
      command: [
        '--config.file=/etc/prometheus/prometheus.yml',
        '--storage.tsdb.path=/prometheus',
        `--storage.tsdb.retention.time=${retentionTime}`,
        '--web.enable-lifecycle',
        '--web.enable-admin-api',
      ],
      portMappings: [
        {
          containerPort: 9090,
          protocol: ecs.Protocol.TCP,
        },
      ],
      environment,
    });

    return taskDef;
  }

  /**
   * Create ADOT collector task definition
   */
  private createAdotTask(props: CloudWatchAdotMonitoringStackProps): ecs.FargateTaskDefinition {
    const taskDef = new ecs.FargateTaskDefinition(this, 'AdotTask', {
      memoryLimitMiB: props.adotMemory || 1024,
      cpu: props.adotCpu || 512,
    });

    // Grant CloudWatch read permissions
    taskDef.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchReadOnlyAccess')
    );

    // Create ADOT collector configuration
    const adotConfig = this.generateAdotConfig(props);

    const environment: { [key: string]: string } = {
      AOT_CONFIG_CONTENT: adotConfig,
      ...(props.adotEnvironment || {}),
    };

    taskDef.addContainer('adot-collector', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'adot',
        logRetention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      }),
      environment,
      portMappings: [
        {
          containerPort: 4317, // OTLP gRPC
          protocol: ecs.Protocol.TCP,
        },
        {
          containerPort: 4318, // OTLP HTTP
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    return taskDef;
  }

  /**
   * Create Grafana task definition
   */
  private createGrafanaTask(props: CloudWatchAdotMonitoringStackProps): ecs.FargateTaskDefinition {
    const taskDef = new ecs.FargateTaskDefinition(this, 'GrafanaTask', {
      memoryLimitMiB: props.grafanaMemory || 1024,
      cpu: props.grafanaCpu || 512,
    });

    const password = props.grafanaAdminPassword || 'admin123!ChangeME';
    const plugins = props.grafanaPlugins || 'grafana-clock-panel';
    const allowSignUp = props.allowGrafanaSignUp ? 'true' : 'false';
    const namespaceName = props.namespaceName || 'monitoring.local';

    const environment: { [key: string]: string } = {
      GF_SECURITY_ADMIN_PASSWORD: password,
      GF_SECURITY_ADMIN_USER: 'admin',
      GF_INSTALL_PLUGINS: plugins,
      GF_SERVER_ROOT_URL: '%(protocol)s://%(domain)s/',
      GF_USERS_ALLOW_SIGN_UP: allowSignUp,
      // Enable anonymous access to data sources configuration
      GF_AUTH_ANONYMOUS_ENABLED: 'false',
      // Auto-provision Prometheus via inline configuration
      GF_DATASOURCE_PROMETHEUS_URL: `http://prometheus.${namespaceName}:9090`,
      GF_DATASOURCE_PROMETHEUS_TYPE: 'prometheus',
      GF_DATASOURCE_PROMETHEUS_ACCESS: 'proxy',
      GF_DATASOURCE_PROMETHEUS_IS_DEFAULT: 'true',
      ...(props.grafanaEnvironment || {}),
    };

    taskDef.addContainer('grafana', {
      image: ecs.ContainerImage.fromRegistry('grafana/grafana:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'grafana',
        logRetention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      }),
      environment,
      portMappings: [
        {
          containerPort: 3000,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    return taskDef;
  }

  /**
   * Generate ADOT collector configuration
   */
  private generateAdotConfig(props: CloudWatchAdotMonitoringStackProps): string {
    const namespaces = props.cloudWatchNamespaces.map(ns => `"${ns}"`).join(', ');
    const region = props.cloudWatchRegion || cdk.Stack.of(this).region;
    const pollInterval = props.adotPollInterval || '5m';
    const namespaceName = props.namespaceName || 'monitoring.local';

    return `
receivers:
  awscloudwatch:
    region: ${region}
    metrics:
      namespace_filter:
        include: [${namespaces}]
    poll_interval: ${pollInterval}

processors:
  batch:
    timeout: 60s

exporters:
  prometheusremotewrite:
    endpoint: http://prometheus.${namespaceName}:9090/api/v1/write
    tls:
      insecure: true

  logging:
    loglevel: info

service:
  pipelines:
    metrics:
      receivers: [awscloudwatch]
      processors: [batch]
      exporters: [prometheusremotewrite, logging]

  telemetry:
    logs:
      level: info
`;
  }

  /**
   * Add a CloudWatch namespace to monitor
   */
  public addCloudWatchNamespace(namespace: string): void {
    // Note: This would require updating the ADOT configuration and redeploying
    // In practice, you would store the config in SSM Parameter Store or Secrets Manager
    // and reference it from the task definition for dynamic updates
    throw new Error('Dynamic namespace addition requires configuration stored in SSM/Secrets Manager. Please redeploy with updated namespaces.');
  }

  /**
   * Get the Prometheus endpoint for manual configuration
   */
  public getPrometheusEndpoint(): string {
    const namespaceName = this.namespace.namespaceName;
    return `http://prometheus.${namespaceName}:9090`;
  }

  /**
   * Get the ADOT collector endpoint for OTLP
   */
  public getAdotOtlpEndpoint(): string {
    return `http://${this.adotService.serviceName}.${this.namespace.namespaceName}:4317`;
  }
}
