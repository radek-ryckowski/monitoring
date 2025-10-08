import * as cdk from 'aws-cdk-lib';
import * as oam from 'aws-cdk-lib/aws-oam';
import { Construct } from 'constructs';

// Export monitoring stack
export * from './monitoring-stack';

/**
 * Configuration for metrics to be shared via OAM
 */
export interface MetricConfiguration {
  /**
   * Namespace of the metric (e.g., 'AWS/EC2', 'AWS/Lambda')
   */
  readonly namespace: string;

  /**
   * Metric name (e.g., 'CPUUtilization', 'Invocations')
   */
  readonly metricName: string;

  /**
   * Dimensions for the metric (optional)
   * Example: { InstanceId: 'i-1234567890abcdef0' }
   */
  readonly dimensions?: { [key: string]: string };
}


/**
 * Properties for the CloudWatch Observability Target (Monitoring Account)
 */
export interface CloudWatchObservabilityTargetProps {
  /**
   * Name for the sink
   */
  readonly sinkName: string;

  /**
   * List of source account IDs allowed to link to this sink
   * @default - No specific accounts (must use organizationId)
   */
  readonly sourceAccountIds?: string[];

  /**
   * Organization ID to allow all accounts in the organization
   * Supports wildcards (e.g., 'o-*' to match all organizations)
   * @default - No organization access
   */
  readonly organizationId?: string;

  /**
   * Organizational unit IDs to allow
   * Supports wildcards (e.g., 'ou-*' to match all OUs, or specific patterns like 'ou-abc-*')
   * @default - No OU restrictions
   */
  readonly organizationalUnitIds?: string[];

  /**
   * Tags to apply to the sink
   * @default - No tags
   */
  readonly tags?: { [key: string]: string };
}

/**
 * L3 Construct for CloudWatch Observability Target (Monitoring Account)
 *
 * This construct creates an OAM Sink that receives CloudWatch data from source accounts.
 */
export class CloudWatchObservabilityTarget extends Construct {
  /**
   * The OAM Sink
   */
  public readonly sink: oam.CfnSink;

  /**
   * The sink ARN
   */
  public readonly sinkArn: string;

  /**
   * The sink identifier
   */
  public readonly sinkIdentifier: string;

  constructor(scope: Construct, id: string, props: CloudWatchObservabilityTargetProps) {
    super(scope, id);

    if (!props.sourceAccountIds && !props.organizationId) {
      throw new Error('Either sourceAccountIds or organizationId must be specified');
    }

    // Build the policy document
    const policyStatements: any[] = [];

    if (props.sourceAccountIds && props.sourceAccountIds.length > 0) {
      policyStatements.push({
        Effect: 'Allow',
        Principal: {
          AWS: props.sourceAccountIds.map(accountId => `arn:aws:iam::${accountId}:root`)
        },
        Action: [
          'oam:CreateLink',
          'oam:UpdateLink'
        ],
        Resource: '*',
        Condition: {
          'ForAllValues:StringEquals': {
            'oam:ResourceTypes': [
              'AWS::CloudWatch::Metric',
              'AWS::Logs::LogGroup'
            ]
          }
        }
      });
    }

    if (props.organizationId) {
      const condition: any = {};

      // Use StringLike to support wildcards in organization ID
      const hasWildcard = props.organizationId.includes('*') || props.organizationId.includes('?');
      const orgConditionKey = hasWildcard ? 'StringLike' : 'StringEquals';

      condition[orgConditionKey] = {
        'aws:PrincipalOrgID': props.organizationId
      };

      if (props.organizationalUnitIds && props.organizationalUnitIds.length > 0) {
        // Check if any OU ID contains wildcards
        const ouHasWildcard = props.organizationalUnitIds.some(ouId =>
          ouId.includes('*') || ouId.includes('?')
        );
        const ouConditionKey = ouHasWildcard ? 'ForAnyValue:StringLike' : 'ForAnyValue:StringEquals';

        condition[ouConditionKey] = {
          'aws:PrincipalOrgPaths': props.organizationalUnitIds.map(
            ouId => `${props.organizationId}/*/${ouId}/*`
          )
        };
      }

      policyStatements.push({
        Effect: 'Allow',
        Principal: '*',
        Action: [
          'oam:CreateLink',
          'oam:UpdateLink'
        ],
        Resource: '*',
        Condition: condition
      });
    }

    // Create the sink
    this.sink = new oam.CfnSink(this, 'Sink', {
      name: props.sinkName,
      policy: {
        Version: '2012-10-17',
        Statement: policyStatements
      },
      tags: props.tags
    });

    this.sinkArn = this.sink.attrArn;
    this.sinkIdentifier = this.sink.ref;

    // Output the sink ARN for source accounts
    new cdk.CfnOutput(this, 'SinkArn', {
      value: this.sinkArn,
      description: 'ARN of the CloudWatch Observability Sink',
      exportName: `${cdk.Stack.of(this).stackName}-SinkArn`
    });

    new cdk.CfnOutput(this, 'SinkIdentifier', {
      value: this.sinkIdentifier,
      description: 'Identifier of the CloudWatch Observability Sink'
    });
  }

  /**
   * Add additional source account IDs to the sink policy
   */
  public addSourceAccount(accountId: string): void {
    const currentPolicy = this.sink.policy as any;
    const statements = currentPolicy.Statement as any[];

    // Find or create the account-specific statement
    let accountStatement = statements.find(s => s.Principal?.AWS);

    if (accountStatement) {
      const principals = Array.isArray(accountStatement.Principal.AWS)
        ? accountStatement.Principal.AWS
        : [accountStatement.Principal.AWS];

      const newArn = `arn:aws:iam::${accountId}:root`;
      if (!principals.includes(newArn)) {
        principals.push(newArn);
        accountStatement.Principal.AWS = principals;
      }
    } else {
      statements.push({
        Effect: 'Allow',
        Principal: {
          AWS: [`arn:aws:iam::${accountId}:root`]
        },
        Action: [
          'oam:CreateLink',
          'oam:UpdateLink'
        ],
        Resource: '*',
        Condition: {
          'ForAllValues:StringEquals': {
            'oam:ResourceTypes': [
              'AWS::CloudWatch::Metric',
              'AWS::Logs::LogGroup'
            ]
          }
        }
      });
    }

    this.sink.policy = currentPolicy;
  }
}

/**
 * Properties for the CloudWatch Observability Source (Source Account)
 */
export interface CloudWatchObservabilitySourceProps {
  /**
   * Name for the link
   */
  readonly linkName: string;

  /**
   * ARN of the sink in the monitoring account
   */
  readonly sinkArn: string;

  /**
   * Resource types to share
   * @default - ['AWS::CloudWatch::Metric', 'AWS::Logs::LogGroup']
   */
  readonly resourceTypes?: string[];

  /**
   * Specific metrics to include
   * @default - All metrics in the account
   */
  readonly metrics?: MetricConfiguration[];

  /**
   * CloudWatch Log Group names or ARNs to share
   * @default - All log groups
   */
  readonly logGroupNames?: string[];

  /**
   * Label template for the source
   * @default - Account ID
   */
  readonly labelTemplate?: string;

  /**
   * Tags to apply to the link
   * @default - No tags
   */
  readonly tags?: { [key: string]: string };
}

/**
 * L3 Construct for CloudWatch Observability Source (Source Account)
 *
 * This construct creates an OAM Link that sends CloudWatch data to a monitoring account.
 */
export class CloudWatchObservabilitySource extends Construct {
  /**
   * The OAM Link
   */
  public readonly link: oam.CfnLink;

  /**
   * The link ARN
   */
  public readonly linkArn: string;

  constructor(scope: Construct, id: string, props: CloudWatchObservabilitySourceProps) {
    super(scope, id);

    const resourceTypes = props.resourceTypes ?? [
      'AWS::CloudWatch::Metric',
      'AWS::Logs::LogGroup'
    ];

    // Build link configuration
    const linkConfiguration: any = {
      MetricConfiguration: {},
      LogGroupConfiguration: {}
    };

    // Configure metrics filter if specified
    if (props.metrics && props.metrics.length > 0) {
      linkConfiguration.MetricConfiguration = {
        Filter: JSON.stringify({
          Namespace: props.metrics.map(m => m.namespace),
          Metrics: props.metrics.map(m => ({
            Namespace: m.namespace,
            MetricName: m.metricName,
            ...(m.dimensions && { Dimensions: m.dimensions })
          }))
        })
      };
    } else {
      linkConfiguration.MetricConfiguration = {
        Filter: JSON.stringify({ Namespace: ['*'] })
      };
    }

    // Configure log groups filter if specified
    if (props.logGroupNames && props.logGroupNames.length > 0) {
      linkConfiguration.LogGroupConfiguration = {
        Filter: JSON.stringify({
          LogGroupNames: props.logGroupNames
        })
      };
    } else {
      linkConfiguration.LogGroupConfiguration = {
        Filter: JSON.stringify({ LogGroupNames: ['*'] })
      };
    }

    // Create the link
    this.link = new oam.CfnLink(this, 'Link', {
      resourceTypes,
      sinkIdentifier: props.sinkArn,
      labelTemplate: props.labelTemplate ?? '$AccountId',
      linkConfiguration,
      tags: props.tags
    });

    this.linkArn = this.link.attrArn;

    // Output the link ARN
    new cdk.CfnOutput(this, 'LinkArn', {
      value: this.linkArn,
      description: 'ARN of the CloudWatch Observability Link'
    });

    new cdk.CfnOutput(this, 'LinkLabel', {
      value: this.link.attrLabel,
      description: 'Label of the CloudWatch Observability Link'
    });
  }

  /**
   * Add a metric to the configuration
   */
  public addMetric(metric: MetricConfiguration): void {
    const config = this.link.linkConfiguration as any;
    const currentFilter = JSON.parse(config.MetricConfiguration.Filter);

    if (!currentFilter.Metrics) {
      currentFilter.Metrics = [];
    }

    currentFilter.Metrics.push({
      Namespace: metric.namespace,
      MetricName: metric.metricName,
      ...(metric.dimensions && { Dimensions: metric.dimensions })
    });

    if (!currentFilter.Namespace.includes(metric.namespace)) {
      currentFilter.Namespace.push(metric.namespace);
    }

    config.MetricConfiguration.Filter = JSON.stringify(currentFilter);
    this.link.linkConfiguration = config;
  }

  /**
   * Add a log group to the configuration
   */
  public addLogGroup(logGroupName: string): void {
    const config = this.link.linkConfiguration as any;
    const currentFilter = JSON.parse(config.LogGroupConfiguration.Filter);

    if (!currentFilter.LogGroupNames) {
      currentFilter.LogGroupNames = [];
    }

    if (!currentFilter.LogGroupNames.includes(logGroupName)) {
      currentFilter.LogGroupNames.push(logGroupName);
    }

    config.LogGroupConfiguration.Filter = JSON.stringify(currentFilter);
    this.link.linkConfiguration = config;
  }
}
