/**
 * Billing dashboard configuration types
 */

export interface BillingDashboardConfig {
  /**
   * Enable billing dashboard
   * @default false
   */
  enabled: boolean;

  /**
   * Dashboard name
   * @default 'BillingDashboard'
   */
  dashboardName?: string;

  /**
   * Enable cost anomaly detection
   * @default true
   */
  enableAnomalyDetection?: boolean;

  /**
   * Cost budget configurations
   */
  budgets?: BudgetConfig[];

  /**
   * Services to track costs for
   * @default - All services
   */
  trackedServices?: string[];

  /**
   * Cost allocation tags to track
   */
  costAllocationTags?: string[];

  /**
   * Enable forecasting
   * @default true
   */
  enableForecasting?: boolean;

  /**
   * Forecast period in days
   * @default 30
   */
  forecastDays?: number;
}

export interface BudgetConfig {
  /**
   * Budget name
   */
  name: string;

  /**
   * Budget amount in USD
   */
  amount: number;

  /**
   * Time period for budget
   * @default 'MONTHLY'
   */
  timeUnit?: 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

  /**
   * Threshold percentages for alerts
   * @default [80, 100]
   */
  thresholds?: number[];

  /**
   * Email addresses for notifications
   */
  notificationEmails?: string[];

  /**
   * SNS topic ARN for notifications
   */
  snsTopicArn?: string;

  /**
   * Cost filters
   */
  filters?: {
    services?: string[];
    tags?: { [key: string]: string };
    linkedAccounts?: string[];
  };
}

export interface CostMetricConfig {
  /**
   * Metric name
   */
  name: string;

  /**
   * Service name (e.g., 'AmazonEC2', 'AWSLambda')
   */
  service: string;

  /**
   * Cost type
   */
  costType: 'UnblendedCost' | 'BlendedCost' | 'AmortizedCost' | 'UsageQuantity';

  /**
   * Dimensions to group by
   */
  dimensions?: string[];

  /**
   * Tags to filter by
   */
  tags?: { [key: string]: string };
}
