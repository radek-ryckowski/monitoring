import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { BillingDashboardConfig, BudgetConfig } from './billing-config';
import { BillingWidgetBuilder } from './billing-widgets';

export interface BillingDashboardProps {
  /**
   * Configuration loaded from JSON or inline
   */
  config: BillingDashboardConfig;

  /**
   * AWS account ID
   */
  accountId?: string;

  /**
   * Services being monitored
   */
  monitoredServices?: string[];
}

/**
 * Billing Dashboard Construct
 * Creates comprehensive billing and cost monitoring dashboards
 */
export class BillingDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly budgets: budgets.CfnBudget[] = [];
  public readonly costAlarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: BillingDashboardProps) {
    super(scope, id);

    const config = props.config;
    const accountId = props.accountId || cdk.Stack.of(this).account;
    const dashboardName = config.dashboardName || 'BillingDashboard';

    // Create dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName,
    });

    // Add header
    this.dashboard.addWidgets(BillingWidgetBuilder.createBillingHeaderWidget(accountId));

    // Add total cost widget and current month widget in first row
    this.dashboard.addWidgets(
      BillingWidgetBuilder.createTotalCostWidget(),
      BillingWidgetBuilder.createCurrentMonthCostWidget()
    );

    // Determine which services to show
    const servicesToShow = this.determineServicesToShow(config, props.monitoredServices);

    // Add service comparison widget if multiple services
    if (servicesToShow.length > 1) {
      this.dashboard.addWidgets(
        BillingWidgetBuilder.createServiceCostComparisonWidget(servicesToShow)
      );
    }

    // Add individual service cost widgets
    this.addServiceCostWidgets(servicesToShow);

    // Add cost optimization tips
    this.dashboard.addWidgets(BillingWidgetBuilder.createCostOptimizationWidget());

    // Create budgets if configured
    if (config.budgets && config.budgets.length > 0) {
      this.createBudgets(config.budgets, accountId);
    }

    // Output dashboard URL
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${
        cdk.Stack.of(this).region
      }#dashboards:name=${dashboardName}`,
      description: 'Billing Dashboard URL',
    });
  }

  private determineServicesToShow(
    config: BillingDashboardConfig,
    monitoredServices?: string[]
  ): string[] {
    if (config.trackedServices && config.trackedServices.length > 0) {
      return config.trackedServices;
    }

    if (monitoredServices && monitoredServices.length > 0) {
      return monitoredServices;
    }

    // Default services
    return [
      'AmazonEC2',
      'AWSLambda',
      'AmazonRDS',
      'AmazonDynamoDB',
      'AmazonS3',
      'AmazonECS',
    ];
  }

  private addServiceCostWidgets(services: string[]): void {
    const widgetMap: { [key: string]: () => cloudwatch.IWidget } = {
      AmazonEC2: () => BillingWidgetBuilder.createEC2CostWidget(),
      AWSLambda: () => BillingWidgetBuilder.createLambdaCostWidget(),
      AmazonRDS: () => BillingWidgetBuilder.createRDSCostWidget(),
      AmazonDynamoDB: () => BillingWidgetBuilder.createDynamoDBCostWidget(),
      AmazonS3: () => BillingWidgetBuilder.createS3CostWidget(),
      AmazonECS: () => BillingWidgetBuilder.createECSCostWidget(),
    };

    const widgets: cloudwatch.IWidget[] = [];

    for (const service of services) {
      if (widgetMap[service]) {
        widgets.push(widgetMap[service]());
      } else {
        // Create generic widget for unknown services
        widgets.push(BillingWidgetBuilder.createServiceCostWidget(service));
      }
    }

    // Add widgets in rows of 4
    for (let i = 0; i < widgets.length; i += 4) {
      this.dashboard.addWidgets(...widgets.slice(i, i + 4));
    }
  }

  private createBudgets(budgetConfigs: BudgetConfig[], accountId: string): void {
    for (const budgetConfig of budgetConfigs) {
      const budget = this.createBudget(budgetConfig, accountId);
      this.budgets.push(budget);
    }
  }

  private createBudget(config: BudgetConfig, accountId: string): budgets.CfnBudget {
    const thresholds = config.thresholds || [80, 100];
    const timeUnit = config.timeUnit || 'MONTHLY';

    // Build notification subscribers
    const subscribers: budgets.CfnBudget.SubscriberProperty[] = [];

    if (config.notificationEmails && config.notificationEmails.length > 0) {
      for (const email of config.notificationEmails) {
        subscribers.push({
          subscriptionType: 'EMAIL',
          address: email,
        });
      }
    }

    if (config.snsTopicArn) {
      subscribers.push({
        subscriptionType: 'SNS',
        address: config.snsTopicArn,
      });
    }

    // Create notifications for each threshold
    const notificationsWithSubscribers: budgets.CfnBudget.NotificationWithSubscribersProperty[] =
      thresholds.map((threshold) => ({
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers,
      }));

    // Build cost filters
    const costFilters: any = {};

    if (config.filters?.services && config.filters.services.length > 0) {
      costFilters.Service = config.filters.services;
    }

    if (config.filters?.linkedAccounts && config.filters.linkedAccounts.length > 0) {
      costFilters.LinkedAccount = config.filters.linkedAccounts;
    }

    if (config.filters?.tags) {
      for (const [key, value] of Object.entries(config.filters.tags)) {
        costFilters[`user:${key}`] = [value];
      }
    }

    const budget = new budgets.CfnBudget(this, `Budget-${config.name}`, {
      budget: {
        budgetName: config.name,
        budgetType: 'COST',
        timeUnit,
        budgetLimit: {
          amount: config.amount,
          unit: 'USD',
        },
        costFilters: Object.keys(costFilters).length > 0 ? costFilters : undefined,
      },
      notificationsWithSubscribers,
    });

    return budget;
  }

  /**
   * Add custom cost alarm
   */
  public addCostAlarm(
    id: string,
    serviceName: string,
    threshold: number,
    snsTopicArn?: string
  ): cloudwatch.Alarm {
    const metric = new cloudwatch.Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: {
        ServiceName: serviceName,
        Currency: 'USD',
      },
      statistic: 'Maximum',
      period: cdk.Duration.hours(6),
      region: 'us-east-1',
    });

    const alarm = new cloudwatch.Alarm(this, id, {
      metric,
      threshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: `${serviceName} cost exceeded $${threshold}`,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (snsTopicArn) {
      const topic = sns.Topic.fromTopicArn(this, `${id}-Topic`, snsTopicArn);
      alarm.addAlarmAction({
        bind: () => ({ alarmActionArn: topic.topicArn }),
      });
    }

    this.costAlarms.push(alarm);
    return alarm;
  }

  /**
   * Add custom widget to the dashboard
   */
  public addCustomWidget(widget: cloudwatch.IWidget): void {
    this.dashboard.addWidgets(widget);
  }
}
