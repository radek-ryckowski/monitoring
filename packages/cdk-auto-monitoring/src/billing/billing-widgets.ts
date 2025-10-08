import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Duration } from 'aws-cdk-lib';

/**
 * Builder for billing and cost-related CloudWatch widgets
 */
export class BillingWidgetBuilder {
  /**
   * Create widget for total estimated charges
   */
  static createTotalCostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'Total Estimated Charges',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1', // Billing metrics only in us-east-1
        }),
      ],
      width: 12,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget for service-specific costs
   */
  static createServiceCostWidget(
    serviceName: string,
    region: string = 'us-east-1'
  ): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: `${serviceName} - Estimated Charges`,
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: serviceName,
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget comparing costs across multiple services
   */
  static createServiceCostComparisonWidget(
    services: string[],
    region: string = 'us-east-1'
  ): cloudwatch.GraphWidget {
    const metrics = services.map(
      (service) =>
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: service,
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
          label: service,
        })
    );

    return new cloudwatch.GraphWidget({
      title: 'Service Cost Comparison',
      left: metrics,
      width: 12,
      height: 6,
      stacked: true,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create single value widget for current month cost
   */
  static createCurrentMonthCostWidget(region: string = 'us-east-1'): cloudwatch.SingleValueWidget {
    return new cloudwatch.SingleValueWidget({
      title: 'Current Month Cost',
      metrics: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 4,
      setPeriodToTimeRange: false,
    });
  }

  /**
   * Create widget for EC2 costs breakdown
   */
  static createEC2CostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'EC2 Cost Breakdown',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AmazonEC2',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
          label: 'EC2 Instances',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AmazonEBS',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
          label: 'EBS Volumes',
        }),
      ],
      width: 12,
      height: 6,
      stacked: true,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget for Lambda costs
   */
  static createLambdaCostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'Lambda - Estimated Charges',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AWSLambda',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget for RDS costs
   */
  static createRDSCostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'RDS - Estimated Charges',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AmazonRDS',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget for DynamoDB costs
   */
  static createDynamoDBCostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'DynamoDB - Estimated Charges',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AmazonDynamoDB',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget for S3 costs
   */
  static createS3CostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'S3 - Estimated Charges',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AmazonS3',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create widget for ECS costs
   */
  static createECSCostWidget(region: string = 'us-east-1'): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'ECS - Estimated Charges',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: 'AmazonECS',
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
        }),
      ],
      width: 6,
      height: 6,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }

  /**
   * Create header widget for billing dashboard
   */
  static createBillingHeaderWidget(accountId: string): cloudwatch.TextWidget {
    return new cloudwatch.TextWidget({
      markdown: `# AWS Billing Dashboard\n\n**Account:** ${accountId}\n\n**Note:** Billing metrics update every 6 hours and are only available in us-east-1 region.\n\n**Currency:** USD`,
      width: 24,
      height: 3,
    });
  }

  /**
   * Create cost optimization recommendations widget
   */
  static createCostOptimizationWidget(): cloudwatch.TextWidget {
    return new cloudwatch.TextWidget({
      markdown: `## Cost Optimization Tips\n\n- Monitor unused resources (idle EC2, unattached EBS)\n- Right-size over-provisioned instances\n- Use Savings Plans and Reserved Instances\n- Enable auto-scaling for variable workloads\n- Delete old snapshots and AMIs\n- Use S3 lifecycle policies for cold data`,
      width: 12,
      height: 6,
    });
  }

  /**
   * Create custom cost widget with multiple metrics
   */
  static createCustomCostWidget(
    title: string,
    serviceMetrics: Array<{ serviceName: string; label: string }>,
    region: string = 'us-east-1'
  ): cloudwatch.GraphWidget {
    const metrics = serviceMetrics.map(
      ({ serviceName, label }) =>
        new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: {
            ServiceName: serviceName,
            Currency: 'USD',
          },
          statistic: 'Maximum',
          period: Duration.hours(6),
          region: 'us-east-1',
          label,
        })
    );

    return new cloudwatch.GraphWidget({
      title,
      left: metrics,
      width: 12,
      height: 6,
      stacked: false,
      leftYAxis: {
        label: 'Cost (USD)',
        showUnits: false,
      },
    });
  }
}
