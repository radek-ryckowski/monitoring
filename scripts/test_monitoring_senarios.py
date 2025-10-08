#!/usr/bin/env python3
"""
Tests all scenarios from example-stacks.ts with cross-account monitoring
"""

import os
import sys
import subprocess
import json
import time
from typing import Optional, Dict, List
from dataclasses import dataclass
import configparser


@dataclass
class AccountConfig:
    """AWS Account Configuration"""
    monitoring_account_id: str
    monitoring_profile: str
    monitoring_region: str
    application_account_id: str
    application_profile: str
    application_region: str
    default_app_name: str
    default_environment: str
    alarm_topic_arn: Optional[str] = None


class Colors:
    """ANSI color codes"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def print_header(text: str):
    """Print colored header"""
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{text.center(60)}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}\n")


def print_success(text: str):
    """Print success message"""
    print(f"{Colors.GREEN}✓{Colors.RESET} {text}")


def print_error(text: str):
    """Print error message"""
    print(f"{Colors.RED}✗{Colors.RESET} {text}", file=sys.stderr)


def print_info(text: str):
    """Print info message"""
    print(f"{text}")


def print_warning(text: str):
    """Print warning message"""
    print(f"{Colors.YELLOW}⚠{Colors.RESET} {text}")


def load_config() -> AccountConfig:
    """Load configuration from config/accounts.config"""
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config', 'accounts.config')

    if not os.path.exists(config_path):
        print_error(f"Configuration file not found: {config_path}")
        sys.exit(1)

    config = configparser.ConfigParser()
    config.read(config_path)

    return AccountConfig(
        monitoring_account_id=config.get('monitoring', 'account_id'),
        monitoring_profile=config.get('monitoring', 'profile'),
        monitoring_region=config.get('monitoring', 'region'),
        application_account_id=config.get('application', 'account_id'),
        application_profile=config.get('application', 'profile'),
        application_region=config.get('application', 'region'),
        default_app_name=config.get('defaults', 'app_name'),
        default_environment=config.get('defaults', 'environment'),
        alarm_topic_arn=config.get('defaults', 'alarm_topic_arn', fallback=None)
    )


def run_command(cmd: List[str], env: Optional[Dict[str, str]] = None, cwd: Optional[str] = None) -> tuple[int, str, str]:
    """Run shell command and return (returncode, stdout, stderr)"""
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=merged_env,
        cwd=cwd,
        text=True
    )

    stdout, stderr = process.communicate()
    return process.returncode, stdout, stderr


def build_project(project_root: str) -> bool:
    """Build the CDK project"""
    print_info("Building project...")
    returncode, stdout, stderr = run_command(['npm', 'run', 'build'], cwd=project_root)

    if returncode == 0:
        print_success("Build complete")
        return True
    else:
        print_error("Build failed")
        print(stderr)
        return False


def check_bootstrap(account_id: str, region: str, profile: str) -> bool:
    """Check if CDK is bootstrapped in the account"""
    print_info(f"Checking CDK bootstrap for account {account_id}...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', 'CDKToolkit',
         '--region', region,
         '--profile', profile],
        env={'AWS_PROFILE': profile}
    )

    if returncode != 0:
        print_warning(f"CDK not bootstrapped in account {account_id}")
        print_info(f"Run: cdk bootstrap aws://{account_id}/{region} --profile {profile}")
        response = input(f"{Colors.YELLOW}Bootstrap now? (y/n): {Colors.RESET}").lower()

        if response == 'y':
            print_info("Bootstrapping CDK...")
            returncode, stdout, stderr = run_command(
                ['npx', 'cdk', 'bootstrap',
                 f'aws://{account_id}/{region}',
                 '--profile', profile],
                env={'AWS_PROFILE': profile}
            )

            if returncode != 0:
                print_error("Bootstrap failed")
                print(stderr)
                return False

            print_success("Bootstrap complete")
            return True
        else:
            return False
    else:
        print_success("CDK already bootstrapped")
        return True


def deploy_monitoring_account(config: AccountConfig, project_root: str, enable_adot: bool = False, enable_container_insights: bool = True) -> Optional[str]:
    """Deploy monitoring account and return sink ARN

    Args:
        config: Account configuration
        project_root: Project root directory
        enable_adot: Enable ADOT Collector with Prometheus and Grafana
        enable_container_insights: Enable Container Insights for ECS cluster
    """
    print_header("Deploying Monitoring Account")

    print_info(f"Account: {config.monitoring_account_id}")
    print_info(f"Profile: {config.monitoring_profile}")
    print_info(f"Region: {config.monitoring_region}")

    if enable_adot:
        print_info("ADOT Monitoring: ENABLED (CloudWatch + Prometheus + Grafana)")
    else:
        print_info("ADOT Monitoring: DISABLED (CloudWatch only)")

    print_info(f"Container Insights: {'ENABLED' if enable_container_insights else 'DISABLED'}")

    # Check AWS credentials
    print_info("Verifying AWS credentials...")
    returncode, stdout, stderr = run_command(
        ['aws', 'sts', 'get-caller-identity',
         '--profile', config.monitoring_profile,
         '--region', config.monitoring_region]
    )

    if returncode != 0:
        print_error(f"Cannot access AWS with profile '{config.monitoring_profile}'")
        print_info("Please run: aws sso login --profile application")
        return None

    identity = json.loads(stdout)
    if identity['Account'] != config.monitoring_account_id:
        print_error(f"Profile resolves to account {identity['Account']}, expected {config.monitoring_account_id}")
        return None

    print_success(f"Authenticated as: {identity['Arn']}")

    # Check bootstrap
    if not check_bootstrap(config.monitoring_account_id, config.monitoring_region, config.monitoring_profile):
        return None

    # Create bin file for monitoring account
    additional_config = []
    if enable_adot:
        # Default CloudWatch namespaces to monitor
        namespaces = ['AWS/ECS', 'AWS/Lambda', 'AWS/RDS', 'AWS/DynamoDB', 'AWS/ApplicationELB', 'AWS/EC2', 'AWS/S3']
        namespaces_str = ', '.join([f"'{ns}'" for ns in namespaces])
        additional_config.append(f"cloudWatchNamespaces: [{namespaces_str}]")
    if not enable_container_insights:
        additional_config.append("enableContainerInsights: false")

    config_line = ""
    if additional_config:
        config_line = ",\n    " + ",\n    ".join(additional_config)

    bin_content = f"""#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {{ MonitoringAccountStack }} from '../lib/example-stacks';

const app = new cdk.App();
new MonitoringAccountStack(app, 'MonitoringAccountStack',
  ['{config.application_account_id}'],
  {{
    env: {{
      account: '{config.monitoring_account_id}',
      region: '{config.monitoring_region}'
    }}{config_line}
  }}
);
"""

    bin_file = os.path.join(project_root, 'bin', 'deploy-monitoring.ts')
    with open(bin_file, 'w') as f:
        f.write(bin_content)

    print_info("Synthesizing CloudFormation template...")

    returncode, stdout, stderr = run_command(
        ['npx', 'cdk', 'synth',
         '--app', 'npx ts-node bin/deploy-monitoring.ts',
         '--profile', config.monitoring_profile,
         'MonitoringAccountStack'],
        cwd=project_root
    )
    print(stdout)
    if returncode != 0:
        print_error("Synthesis failed")
        print(stderr)
        return None

    print_success("Synthesis complete")

    print_warning(f"Ready to deploy to monitoring account {config.monitoring_account_id}")
    response = input(f"{Colors.YELLOW}Continue with deployment? (y/n): {Colors.RESET}").lower()

    if response != 'y':
        print_warning("Deployment cancelled")
        return None

    print_info("Deploying stack...")
    returncode, stdout, stderr = run_command(
        ['npx', 'cdk', 'deploy',
         '--app', 'npx ts-node bin/deploy-monitoring.ts',
         '--profile', config.monitoring_profile,
         '--require-approval', 'never',
         'MonitoringAccountStack'],
        cwd=project_root
    )
    print(stdout)
    if returncode != 0:
        print_error("Deployment failed")
        print(stderr)
        return None

    print_success("Monitoring account deployed!")

    # Extract sink ARN from outputs
    print_info("Retrieving sink ARN...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', 'MonitoringAccountStack',
         '--query', 'Stacks[0].Outputs[?OutputKey==`SinkArn`].OutputValue',
         '--output', 'text',
         '--profile', config.monitoring_profile,
         '--region', config.monitoring_region]
    )

    if returncode == 0:
        sink_arn = stdout.strip()
        print_success(f"Sink ARN: {sink_arn}")
        return sink_arn
    else:
        print_error("Failed to retrieve sink ARN")
        print(stderr)
        return None


def deploy_scenario(scenario_num: int, scenario_name: str, stack_class: str,
                    config: AccountConfig, project_root: str,
                    sink_arn: Optional[str] = None) -> bool:
    """Deploy a specific scenario"""
    print_header(f"Scenario {scenario_num}: {scenario_name}")

    print_info(f"Stack: {stack_class}")
    print_info(f"Account: {config.application_account_id}")
    print_info(f"Profile: {config.application_profile}")
    print_info(f"Region: {config.application_region}")
    if sink_arn:
        print_info(f"Sink ARN: {sink_arn[:50]}...")

    # Check AWS credentials
    print_info("Verifying AWS credentials...")
    returncode, stdout, stderr = run_command(
        ['aws', 'sts', 'get-caller-identity',
         '--profile', config.application_profile,
         '--region', config.application_region]
    )

    if returncode != 0:
        print_error(f"Cannot access AWS with profile '{config.application_profile}'")
        print_info("Please run: aws sso login --profile application")
        return False

    identity = json.loads(stdout)
    if identity['Account'] != config.application_account_id:
        print_error(f"Profile resolves to account {identity['Account']}, expected {config.application_account_id}")
        return False

    print_success(f"Authenticated as: {identity['Arn']}")

    # Check bootstrap
    if not check_bootstrap(config.application_account_id, config.application_region, config.application_profile):
        return False

    # Create bin file for scenario
    sink_param = f", sinkArn: '{sink_arn}'" if sink_arn else ""
    alarm_param = f", enableAlarms: false" if config.alarm_topic_arn else ""

    bin_content = f"""#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {{ {stack_class} }} from '../lib/example-stacks';

const app = new cdk.App();
new {stack_class}(app, 'Scenario{scenario_num}Stack',
  {{
    env: {{
      account: '{config.application_account_id}',
      region: '{config.application_region}'
    }}{sink_param}{alarm_param}
  }}
);
"""

    bin_file = os.path.join(project_root, 'bin', f'deploy-scenario{scenario_num}.ts')
    with open(bin_file, 'w') as f:
        f.write(bin_content)

    print_info(f"Synthesizing CloudFormation template ({bin_file})...")

    returncode, stdout, stderr = run_command(
        ['npx', 'cdk', 'synth',
         '--app', f'npx ts-node bin/deploy-scenario{scenario_num}.ts',
         '--profile', config.application_profile,
         f'Scenario{scenario_num}Stack'],
        cwd=project_root
    )

    if returncode != 0:
        print_error("Synthesis failed")
        print(stderr)
        return False

    print_success("Synthesis complete")

    print_warning(f"Ready to deploy Scenario {scenario_num}")
    response = input(f"{Colors.YELLOW}Continue with deployment? (y/n): {Colors.RESET}").lower()

    if response != 'y':
        print_warning("Deployment skipped")
        return False

    print_info("Deploying stack...")
    returncode, stdout, stderr = run_command(
        ['npx', 'cdk', 'deploy',
         '--app', f'npx ts-node bin/deploy-scenario{scenario_num}.ts',
         '--profile', config.application_profile,
         '--require-approval', 'never',
         f'Scenario{scenario_num}Stack'],
        cwd=project_root
    )

    if returncode != 0:
        print_error("Deployment failed")
        print(stderr)
        return False

    print_success(f"Scenario {scenario_num} deployed successfully!")

    # Show outputs
    print_info("Stack outputs:")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', f'Scenario{scenario_num}Stack',
         '--query', 'Stacks[0].Outputs',
         '--output', 'table',
         '--profile', config.application_profile,
         '--region', config.application_region]
    )

    if returncode == 0:
        print(stdout)

    return True


def test_scenario(scenario_num: int, config: AccountConfig) -> bool:
    """Run basic tests on deployed scenario"""
    print_header(f"Testing Scenario {scenario_num}")

    print_info("Checking CloudWatch dashboards...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudwatch', 'list-dashboards',
         '--profile', config.application_profile,
         '--region', config.application_region]
    )

    if returncode == 0:
        dashboards = json.loads(stdout)
        scenario_dashboards = [d for d in dashboards.get('DashboardEntries', [])
                              if f'Scenario{scenario_num}' in d['DashboardName']]
        if scenario_dashboards:
            print_success(f"Found {len(scenario_dashboards)} dashboard(s)")
            for dash in scenario_dashboards:
                print(f"  - {dash['DashboardName']}")
        else:
            print_warning("No dashboards found yet (may take a few minutes)")

    print_info("Checking OAM links...")
    returncode, stdout, stderr = run_command(
        ['aws', 'oam', 'list-links',
         '--profile', config.application_profile,
         '--region', config.application_region]
    )

    if returncode == 0:
        links = json.loads(stdout)
        if links.get('Items'):
            print_success(f"Found {len(links['Items'])} OAM link(s)")
        else:
            print_info("No OAM links (expected for scenarios without cross-account)")

    return True


def generate_load(scenario_num: int, config: AccountConfig, duration_minutes: int = 5) -> bool:
    """Generate load for a specific scenario to populate metrics

    Args:
        scenario_num: Scenario number (1-5)
        config: Account configuration
        duration_minutes: How long to generate load (default 5 minutes)
    """
    print_header(f"Generating Load for Scenario {scenario_num}")

    print_info(f"Duration: {duration_minutes} minutes")
    print_info("This will invoke Lambda functions, write to DynamoDB, and generate traffic")

    # Get stack outputs to find resource ARNs/URLs
    print_info("Retrieving stack outputs...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', f'Scenario{scenario_num}Stack',
         '--query', 'Stacks[0].Outputs',
         '--output', 'json',
         '--profile', config.application_profile,
         '--region', config.application_region]
    )

    if returncode != 0:
        print_error(f"Failed to retrieve stack outputs. Is Scenario {scenario_num} deployed?")
        return False

    outputs = json.loads(stdout) if stdout else []
    output_dict = {item['OutputKey']: item['OutputValue'] for item in outputs}

    # Load generation based on scenario type
    load_generators = {
        1: generate_load_scenario1,  # ECS + Lambda
        2: generate_load_scenario2,  # ECS + DynamoDB
        3: generate_load_scenario3,  # Full Stack (ALB + ECS + Lambda + RDS + DynamoDB)
        4: generate_load_scenario4,  # Custom Metrics
        5: generate_load_scenario5,  # S3 + Lambda + EC2
        6: generate_load_scenario1,  # Same as Scenario 1 (ECS + Lambda)
    }

    generator = load_generators.get(scenario_num)
    if not generator:
        print_error(f"No load generator for scenario {scenario_num}")
        return False

    return generator(output_dict, config, duration_minutes)


def generate_load_scenario1(outputs: dict, config: AccountConfig, duration: int) -> bool:
    """Generate load for Scenario 1: ECS + Lambda"""
    print_info("Scenario 1: Generating Lambda invocations...")

    # Find Lambda function from outputs (use FunctionName or FunctionArn)
    lambda_name = outputs.get('LambdaFunctionName')

    if not lambda_name:
        print_error("LambdaFunctionName not found in stack outputs")
        print_info("Available outputs: " + ", ".join(outputs.keys()))
        return False

    print_success(f"Found Lambda: {lambda_name}")

    # Invoke Lambda multiple times
    iterations = duration * 12  # Every 5 seconds for duration
    print_info(f"Invoking Lambda {iterations} times over {duration} minutes...")

    for i in range(iterations):
        returncode, stdout, stderr = run_command(
            ['aws', 'lambda', 'invoke',
             '--function-name', lambda_name,
             '--payload', '{"test": "load"}',
             '--profile', config.application_profile,
             '--region', config.application_region,
             '/tmp/lambda-response.json'],
            env={'AWS_PROFILE': config.application_profile}
        )

        if returncode == 0:
            if (i + 1) % 10 == 0:
                print_success(f"Completed {i + 1}/{iterations} invocations")
        else:
            print_warning(f"Invocation {i + 1} failed")

        time.sleep(5)

    print_success(f"Load generation complete! Check CloudWatch dashboards in 2-3 minutes.")
    return True


def generate_load_scenario2(outputs: dict, config: AccountConfig, duration: int) -> bool:
    """Generate load for Scenario 2: ECS + DynamoDB"""
    print_info("Scenario 2: Writing to DynamoDB table...")

    # Find DynamoDB table from outputs
    table_name = outputs.get('TableName')

    if not table_name:
        print_error("TableName not found in stack outputs")
        print_info("Available outputs: " + ", ".join(outputs.keys()))
        return False

    print_success(f"Found DynamoDB table: {table_name}")

    # Write items to DynamoDB
    iterations = duration * 10  # Every 6 seconds
    print_info(f"Writing {iterations} items over {duration} minutes...")

    for i in range(iterations):
        item = {
            'id': {'S': f'load-test-{i}-{int(time.time())}'},
            'timestamp': {'N': str(int(time.time()))},
            'data': {'S': f'Load test item {i}'},
            'scenario': {'S': 'scenario2-load-test'}
        }

        returncode, stdout, stderr = run_command(
            ['aws', 'dynamodb', 'put-item',
             '--table-name', table_name,
             '--item', json.dumps(item),
             '--profile', config.application_profile,
             '--region', config.application_region]
        )

        if returncode == 0:
            if (i + 1) % 10 == 0:
                print_success(f"Wrote {i + 1}/{iterations} items")
        else:
            print_warning(f"Write {i + 1} failed")

        time.sleep(6)

    print_success(f"Load generation complete! Check CloudWatch dashboards in 2-3 minutes.")
    return True


def generate_load_scenario3(outputs: dict, config: AccountConfig, duration: int) -> bool:
    """Generate load for Scenario 3: Full Stack (ALB + ECS + Lambda + RDS + DynamoDB)"""
    print_info("Scenario 3: Generating multi-service load...")

    # Get resources from outputs
    alb_dns = outputs.get('ALBDNSName')
    api_function = outputs.get('APIFunctionName')
    worker_function = outputs.get('WorkerFunctionName')
    table_name = outputs.get('TableName')

    tasks = []

    # Generate ALB traffic if available
    if alb_dns:
        print_success(f"Found ALB: {alb_dns}")
        tasks.append(('alb', alb_dns))

    # Generate Lambda invocations if available
    if api_function:
        print_success(f"Found API Lambda: {api_function}")
        tasks.append(('lambda', api_function))

    if worker_function:
        print_success(f"Found Worker Lambda: {worker_function}")
        tasks.append(('lambda', worker_function))

    # Generate DynamoDB writes if available
    if table_name:
        print_success(f"Found DynamoDB: {table_name}")
        tasks.append(('dynamodb', table_name))

    if not tasks:
        print_error("No resources found to generate load")
        return False

    iterations = duration * 10
    print_info(f"Running {iterations} iterations over {duration} minutes...")

    for i in range(iterations):
        for task_type, resource in tasks:
            if task_type == 'alb':
                # HTTP request to ALB
                returncode, stdout, stderr = run_command(
                    ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                     f'http://{resource}', '--max-time', '5']
                )
                if returncode == 0:
                    print_info(f"ALB request {i + 1}: HTTP {stdout.strip()}")

            elif task_type == 'lambda':
                # Invoke Lambda
                returncode, stdout, stderr = run_command(
                    ['aws', 'lambda', 'invoke',
                     '--function-name', resource,
                     '--payload', '{"test": "load"}',
                     '--profile', config.application_profile,
                     '--region', config.application_region,
                     '/tmp/lambda-response.json']
                )

            elif task_type == 'dynamodb':
                # Write to DynamoDB
                item = {
                    'id': {'S': f'load-test-{i}-{int(time.time())}'},
                    'timestamp': {'N': str(int(time.time()))},
                    'scenario': {'S': 'scenario3-load-test'}
                }
                returncode, stdout, stderr = run_command(
                    ['aws', 'dynamodb', 'put-item',
                     '--table-name', resource,
                     '--item', json.dumps(item),
                     '--profile', config.application_profile,
                     '--region', config.application_region]
                )

        if (i + 1) % 10 == 0:
            print_success(f"Completed {i + 1}/{iterations} iterations")

        time.sleep(6)

    print_success(f"Load generation complete! Check CloudWatch dashboards in 2-3 minutes.")
    return True


def generate_load_scenario4(outputs: dict, config: AccountConfig, duration: int) -> bool:
    """Generate load for Scenario 4: Custom Metrics (ECS + Business Metrics)"""
    print_info("Scenario 4: Generating custom business metrics...")

    # This scenario focuses on ECS services with custom metrics
    # Find ECS cluster and service
    cluster_name = None
    service_name = None

    cluster_name = outputs.get('ECSClusterName')
    service_name = outputs.get('ECSServiceName')

    if cluster_name:
        print_success(f"Found ECS cluster: {cluster_name}")
        print_info(f"ECS tasks will generate metrics automatically")
        print_info(f"Monitoring for {duration} minutes...")
        time.sleep(duration * 60)
        print_success(f"Load generation period complete! Check CloudWatch dashboards.")
        return True
    else:
        print_error("Could not find ECS cluster")
        return False


def generate_load_scenario5(outputs: dict, config: AccountConfig, duration: int) -> bool:
    """Generate load for Scenario 5: S3 + Lambda + EC2"""
    print_info("Scenario 5: Generating S3 and Lambda activity...")

    # Get resources from outputs
    bucket_name = outputs.get('BucketName')
    lambda_name = outputs.get('LambdaFunctionName')

    tasks = []
    if bucket_name:
        print_success(f"Found S3 bucket: {bucket_name}")
        tasks.append(('s3', bucket_name))

    if lambda_name:
        print_success(f"Found Lambda: {lambda_name}")
        tasks.append(('lambda', lambda_name))

    if not tasks:
        print_error("No resources found to generate load")
        return False

    iterations = duration * 10
    print_info(f"Running {iterations} iterations over {duration} minutes...")

    for i in range(iterations):
        for task_type, resource in tasks:
            if task_type == 's3':
                # Upload a test file to S3
                test_file = f'/tmp/load-test-{i}.txt'
                with open(test_file, 'w') as f:
                    f.write(f'Load test file {i} at {time.time()}\n')

                returncode, stdout, stderr = run_command(
                    ['aws', 's3', 'cp',
                     test_file,
                     f's3://{resource}/load-tests/test-{i}.txt',
                     '--profile', config.application_profile,
                     '--region', config.application_region]
                )

                if returncode == 0:
                    # Download it back to generate more metrics
                    run_command(
                        ['aws', 's3', 'cp',
                         f's3://{resource}/load-tests/test-{i}.txt',
                         '/tmp/load-test-download.txt',
                         '--profile', config.application_profile,
                         '--region', config.application_region]
                    )

            elif task_type == 'lambda':
                # Invoke Lambda
                returncode, stdout, stderr = run_command(
                    ['aws', 'lambda', 'invoke',
                     '--function-name', resource,
                     '--payload', '{"test": "load"}',
                     '--profile', config.application_profile,
                     '--region', config.application_region,
                     '/tmp/lambda-response.json']
                )

        if (i + 1) % 10 == 0:
            print_success(f"Completed {i + 1}/{iterations} iterations")

        time.sleep(6)

    print_success(f"Load generation complete! Check CloudWatch dashboards in 2-3 minutes.")
    return True


def destroy_scenario(scenario_num: int, config: AccountConfig, project_root: str) -> bool:
    """Destroy a deployed scenario and clean up deployment files"""
    print_header(f"Destroying Scenario {scenario_num}")

    # Check if stack exists
    print_info(f"Checking if Scenario{scenario_num}Stack exists...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', f'Scenario{scenario_num}Stack',
         '--profile', config.application_profile,
         '--region', config.application_region],
        env={'AWS_PROFILE': config.application_profile}
    )

    if returncode != 0:
        if 'does not exist' in stderr:
            print_warning(f"Scenario{scenario_num}Stack does not exist (already deleted)")
            # Clean up bin file if it exists
            bin_file = os.path.join(project_root, 'bin', f'deploy-scenario{scenario_num}.ts')
            if os.path.exists(bin_file):
                os.remove(bin_file)
                print_info("Cleaned up deployment file")
            return True
        else:
            print_error("Failed to check stack status")
            print(stderr)
            return False

    print_success("Stack exists. Proceeding with destruction...")
    print_warning(f"This will delete all resources in Scenario {scenario_num}")
    response = input(f"{Colors.YELLOW}Continue with destruction? (y/n): {Colors.RESET}").lower()

    if response != 'y':
        print_warning("Destruction cancelled")
        return False

    bin_file = os.path.join(project_root, 'bin', f'deploy-scenario{scenario_num}.ts')

    # Check if bin file exists
    if not os.path.exists(bin_file):
        print_error(f"Deployment file not found: {bin_file}")
        print_warning("Stack exists but deployment file is missing.")
        print_info("Use AWS Console to delete the stack, or recreate the deployment file.")
        return False

    print_info("Destroying stack...")

    returncode, stdout, stderr = run_command(
        ['npx', 'cdk', 'destroy',
         '--app', f'npx ts-node bin/deploy-scenario{scenario_num}.ts',
         '--profile', config.application_profile,
         '--force',
         f'Scenario{scenario_num}Stack'],
        cwd=project_root
    )

    print(stdout)

    if returncode != 0:
        print_error("Destruction failed")
        print(stderr)
        return False

    print_success(f"Scenario {scenario_num} destroyed successfully!")

    # Clean up deployment file
    if os.path.exists(bin_file):
        os.remove(bin_file)
        print_info(f"Cleaned up deployment file: bin/deploy-scenario{scenario_num}.ts")

    return True


def destroy_monitoring_account(config: AccountConfig, project_root: str) -> bool:
    """Destroy monitoring account and clean up deployment files"""
    print_header("Destroying Monitoring Account")

    # Check if stack exists first
    print_info("Checking if monitoring stack exists...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', 'MonitoringAccountStack',
         '--profile', config.monitoring_profile,
         '--region', config.monitoring_region],
        env={'AWS_PROFILE': config.monitoring_profile}
    )

    if returncode != 0:
        if 'does not exist' in stderr:
            print_warning("MonitoringAccountStack does not exist (already deleted)")
            # Clean up bin file if it exists
            bin_file = os.path.join(project_root, 'bin', 'deploy-monitoring.ts')
            if os.path.exists(bin_file):
                os.remove(bin_file)
                print_info("Cleaned up deployment file")
            return True
        else:
            print_error("Failed to check stack status")
            print(stderr)
            return False

    print_success("Stack exists. Proceeding with destruction...")
    print_warning("This will delete the central monitoring sink and all ADOT resources")
    response = input(f"{Colors.YELLOW}Continue with destruction? (y/n): {Colors.RESET}").lower()

    if response != 'y':
        print_warning("Destruction cancelled")
        return False

    # Check if bin file exists, if not recreate it
    bin_file = os.path.join(project_root, 'bin', 'deploy-monitoring.ts')
    temp_file_created = False

    if not os.path.exists(bin_file):
        print_info("Recreating deployment file for destruction...")
        # Parse stack to get source account IDs
        returncode, stdout, stderr = run_command(
            ['aws', 'cloudformation', 'describe-stacks',
             '--stack-name', 'MonitoringAccountStack',
             '--query', 'Stacks[0].Parameters',
             '--profile', config.monitoring_profile,
             '--region', config.monitoring_region],
            env={'AWS_PROFILE': config.monitoring_profile}
        )

        # Create temporary bin file for destruction
        bin_content = f"""#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {{ MonitoringAccountStack }} from '../lib/example-stacks';

const app = new cdk.App();
new MonitoringAccountStack(app, 'MonitoringAccountStack',
  ['{config.application_account_id}'],
  {{
    env: {{
      account: '{config.monitoring_account_id}',
      region: '{config.monitoring_region}'
    }}
  }}
);
"""
        with open(bin_file, 'w') as f:
            f.write(bin_content)
        temp_file_created = True
        print_success("Deployment file recreated")

    print_info("Destroying monitoring account stack...")

    returncode, stdout, stderr = run_command(
        ['npx', 'cdk', 'destroy',
         '--app', 'npx ts-node bin/deploy-monitoring.ts',
         '--profile', config.monitoring_profile,
         '--force',
         'MonitoringAccountStack'],
        cwd=project_root
    )

    print(stdout)

    if returncode != 0:
        print_error("Destruction failed")
        print(stderr)
        return False

    print_success("Monitoring account destroyed successfully!")

    # Clean up deployment file
    if os.path.exists(bin_file):
        os.remove(bin_file)
        print_info("Cleaned up deployment file: bin/deploy-monitoring.ts")

    return True


def list_deployed_stacks(config: AccountConfig) -> List[Dict[str, str]]:
    """List all deployed stacks in both monitoring and application accounts"""
    stacks = []

    # Check monitoring account
    print_info("Checking monitoring account for stacks...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'list-stacks',
         '--stack-status-filter', 'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE',
         '--query', 'StackSummaries[?contains(StackName, `Monitoring`) || contains(StackName, `Scenario`)].{Name:StackName,Status:StackStatus,Created:CreationTime}',
         '--output', 'json',
         '--profile', config.monitoring_profile,
         '--region', config.monitoring_region]
    )

    if returncode == 0:
        monitoring_stacks = json.loads(stdout)
        for stack in monitoring_stacks:
            stacks.append({
                'name': stack['Name'],
                'status': stack['Status'],
                'account': 'monitoring',
                'profile': config.monitoring_profile,
                'region': config.monitoring_region
            })

    # Check application account
    print_info("Checking application account for stacks...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'list-stacks',
         '--stack-status-filter', 'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE',
         '--query', 'StackSummaries[?contains(StackName, `Monitoring`) || contains(StackName, `Scenario`)].{Name:StackName,Status:StackStatus,Created:CreationTime}',
         '--output', 'json',
         '--profile', config.application_profile,
         '--region', config.application_region]
    )

    if returncode == 0:
        app_stacks = json.loads(stdout)
        for stack in app_stacks:
            stacks.append({
                'name': stack['Name'],
                'status': stack['Status'],
                'account': 'application',
                'profile': config.application_profile,
                'region': config.application_region
            })

    return stacks


def interactive_destroy_stacks(config: AccountConfig, project_root: str) -> bool:
    """List available stacks and allow user to select which to destroy"""
    print_header("Destroy Stacks")

    stacks = list_deployed_stacks(config)

    if not stacks:
        print_warning("No stacks found to destroy")
        return False

    print_success(f"Found {len(stacks)} stack(s):")
    print(f"\n{Colors.BOLD}{'#':<4} {'Stack Name':<40} {'Account':<15} {'Status':<25}{Colors.RESET}")
    print(f"{Colors.CYAN}{'─'*90}{Colors.RESET}")

    for idx, stack in enumerate(stacks, 1):
        print(f"{Colors.BOLD}{idx:<4}{Colors.RESET} {stack['name']:<40} {stack['account']:<15} {stack['status']:<25}")

    print(f"{Colors.CYAN}{'─'*90}{Colors.RESET}")
    print(f"{Colors.YELLOW}Enter stack number(s) to destroy (comma-separated), 'all' for all stacks, or 'q' to cancel{Colors.RESET}")

    choice = input(f"{Colors.BOLD}Selection: {Colors.RESET}").strip().lower()

    if choice == 'q':
        print_warning("Destruction cancelled")
        return False

    stacks_to_destroy = []

    if choice == 'all':
        stacks_to_destroy = stacks
    else:
        try:
            indices = [int(x.strip()) for x in choice.split(',')]
            for idx in indices:
                if 1 <= idx <= len(stacks):
                    stacks_to_destroy.append(stacks[idx - 1])
                else:
                    print_error(f"Invalid selection: {idx}")
                    return False
        except ValueError:
            print_error("Invalid input. Please enter numbers separated by commas.")
            return False

    if not stacks_to_destroy:
        print_warning("No stacks selected")
        return False

    # Confirm destruction
    print_warning(f"\nYou are about to destroy {len(stacks_to_destroy)} stack(s):")
    for stack in stacks_to_destroy:
        print(f"  • {stack['name']} ({stack['account']} account)")

    response = input(f"\n{Colors.YELLOW}Are you sure? Type 'yes' to confirm: {Colors.RESET}").strip().lower()

    if response != 'yes':
        print_warning("Destruction cancelled")
        return False

    # Destroy stacks
    success_count = 0
    failed_count = 0

    for stack in stacks_to_destroy:
        print_header(f"Destroying {stack['name']}")

        # Determine if it's a monitoring or scenario stack
        if 'MonitoringAccountStack' in stack['name']:
            if destroy_monitoring_account(config, project_root):
                success_count += 1
            else:
                failed_count += 1
        else:
            # Extract scenario number from stack name
            import re
            match = re.search(r'Scenario(\d+)Stack', stack['name'])
            if match:
                scenario_num = int(match.group(1))

                # Check if bin file exists, if not create temporary one
                bin_file = os.path.join(project_root, 'bin', f'deploy-scenario{scenario_num}.ts')
                temp_file = False

                if not os.path.exists(bin_file):
                    print_info("Creating temporary deployment file for destruction...")
                    # We'll need to recreate the bin file
                    # This is a simplified version - in production you'd want to extract the actual parameters
                    bin_content = f"""#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();
// Temporary file for stack destruction
"""
                    with open(bin_file, 'w') as f:
                        f.write(bin_content)
                    temp_file = True

                # Use destroy_scenario function
                if destroy_scenario(scenario_num, config, project_root):
                    success_count += 1
                else:
                    failed_count += 1
            else:
                print_error(f"Unable to determine how to destroy {stack['name']}")
                failed_count += 1

        time.sleep(2)

    print_header("Destruction Summary")
    print_success(f"Successfully destroyed: {success_count} stack(s)")
    if failed_count > 0:
        print_error(f"Failed to destroy: {failed_count} stack(s)")

    return success_count > 0


def show_menu():
    """Display main menu"""
    print(f"\n{Colors.BOLD}AWS Monitoring Test Scenarios{Colors.RESET}")
    print(f"{Colors.CYAN}{'─'*70}{Colors.RESET}")
    print(f"{Colors.BOLD}Monitoring Account:{Colors.RESET}")
    print(f"  {Colors.BOLD}0.{Colors.RESET} Deploy Monitoring Account (CloudWatch only)")
    print(f"  {Colors.BOLD}A.{Colors.RESET} Deploy with ADOT (CloudWatch + Prometheus + Grafana)")
    print(f"{Colors.CYAN}{'─'*70}{Colors.RESET}")
    print(f"{Colors.BOLD}Application Scenarios:{Colors.RESET}")
    print(f"  {Colors.BOLD}1.{Colors.RESET} Scenario 1 - Minimal (ECS + Lambda)")
    print(f"  {Colors.BOLD}2.{Colors.RESET} Scenario 2 - Cross-Account (ECS + DynamoDB)")
    print(f"  {Colors.BOLD}3.{Colors.RESET} Scenario 3 - Full Stack (ALB + ECS + Lambda + RDS + DynamoDB)")
    print(f"  {Colors.BOLD}4.{Colors.RESET} Scenario 4 - Custom Metrics (ECS + Business Metrics)")
    print(f"  {Colors.BOLD}5.{Colors.RESET} Scenario 5 - Multi-Service (S3 + Lambda + EC2)")
    print(f"  {Colors.BOLD}6.{Colors.RESET} Scenario 6 - Minimal Cross-Account (ECS + Lambda + OAM)")
    print(f"{Colors.CYAN}{'─'*70}{Colors.RESET}")
    print(f"{Colors.BOLD}Actions:{Colors.RESET}")
    print(f"  {Colors.BOLD}l.{Colors.RESET} List all deployed stacks")
    print(f"  {Colors.BOLD}t.{Colors.RESET} Test current scenario")
    print(f"  {Colors.BOLD}g.{Colors.RESET} Generate load for current scenario (populate metrics)")
    print(f"  {Colors.BOLD}G.{Colors.RESET} Show Grafana URL and credentials")
    print(f"  {Colors.BOLD}d.{Colors.RESET} Destroy current scenario")
    print(f"  {Colors.BOLD}D.{Colors.RESET} Destroy stacks (interactive selection)")
    print(f"  {Colors.BOLD}M.{Colors.RESET} Destroy monitoring account")
    print(f"  {Colors.BOLD}q.{Colors.RESET} Quit")
    print(f"{Colors.CYAN}{'─'*70}{Colors.RESET}")


def show_grafana_info(config: AccountConfig) -> bool:
    """Display Grafana URL and access information"""
    print_header("Grafana Access Information")

    # Check if monitoring account stack exists
    print_info("Checking for monitoring account stack...")
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', 'MonitoringAccountStack',
         '--profile', config.monitoring_profile,
         '--region', config.monitoring_region]
    )

    if returncode != 0:
        print_error("Monitoring account stack not found!")
        print_info("Deploy the monitoring account with ADOT first (option A)")
        return False

    # Get stack outputs
    returncode, stdout, stderr = run_command(
        ['aws', 'cloudformation', 'describe-stacks',
         '--stack-name', 'MonitoringAccountStack',
         '--query', 'Stacks[0].Outputs',
         '--output', 'json',
         '--profile', config.monitoring_profile,
         '--region', config.monitoring_region]
    )

    if returncode != 0:
        print_error("Failed to retrieve stack outputs")
        return False

    outputs = json.loads(stdout) if stdout else []
    output_dict = {item['OutputKey']: item['OutputValue'] for item in outputs}

    # Check for Grafana URL
    grafana_url = output_dict.get('GrafanaURL')
    prometheus_console = output_dict.get('PrometheusConsole')
    adot_console = output_dict.get('ADOTCollectorConsole')

    if not grafana_url:
        print_warning("Grafana URL not found in stack outputs")
        print_info("This monitoring account may not have ADOT enabled")
        print_info("Redeploy with ADOT using option 'A'")
        return False

    if grafana_url == 'Not exposed publicly':
        print_warning("Grafana is deployed but not exposed publicly")
        print_info("Public access was disabled during deployment")
        print_info("Access Grafana via VPN or port forwarding")
        return False

    # Display Grafana information
    print_success("Grafana is deployed and accessible!")
    print()
    print(f"{Colors.BOLD}{Colors.CYAN}{'─'*70}{Colors.RESET}")
    print(f"{Colors.BOLD}Grafana URL:{Colors.RESET}")
    print(f"   {Colors.GREEN}{grafana_url}{Colors.RESET}")
    print()
    print(f"{Colors.BOLD}Login Credentials:{Colors.RESET}")
    print(f"   Username: {Colors.YELLOW}admin{Colors.RESET}")
    print(f"   Password: {Colors.YELLOW}admin123!ChangeME{Colors.RESET}")
    print(f"   {Colors.RED}⚠️  Change password after first login!{Colors.RESET}")
    print()
    print(f"{Colors.BOLD}Add Prometheus Data Source (First Time Only):{Colors.RESET}")
    print(f"   1. Click {Colors.YELLOW}⚙️ Configuration{Colors.RESET} → {Colors.YELLOW}Data Sources{Colors.RESET}")
    print(f"   2. Click {Colors.YELLOW}Add data source{Colors.RESET}")
    print(f"   3. Select {Colors.YELLOW}Prometheus{Colors.RESET}")
    print(f"   4. Configure:")
    print(f"      • Name:   {Colors.CYAN}Prometheus{Colors.RESET}")
    print(f"      • URL:    {Colors.CYAN}http://prometheus.monitoring.local:9090{Colors.RESET}")
    print(f"      • Access: {Colors.CYAN}Server (default){Colors.RESET}")
    print(f"   5. Click {Colors.YELLOW}Save & Test{Colors.RESET}")
    print()
    print(f"{Colors.BOLD}Quick Start Guide:{Colors.RESET}")
    print(f"   1. Open Grafana URL in browser")
    print(f"   2. Login with credentials above")
    print(f"   3. Add Prometheus data source (see above)")
    print(f"   4. Import dashboard: Click {Colors.YELLOW}+{Colors.RESET} → {Colors.YELLOW}Import{Colors.RESET} → Enter ID {Colors.CYAN}11159{Colors.RESET}")
    print(f"   5. Generate load with option {Colors.YELLOW}'g'{Colors.RESET} to populate metrics")
    print(f"   6. Wait 2-3 minutes for metrics to appear")
    print(f"{Colors.BOLD}{Colors.CYAN}{'─'*70}{Colors.RESET}")
    print()

    # Display related services
    if prometheus_console:
        print(f"{Colors.BOLD}🔗 Related Services:{Colors.RESET}")
        print(f"   Prometheus Console: {prometheus_console}")
    if adot_console:
        print(f"   ADOT Collector:     {adot_console}")
    print()

    # Display example queries
    print(f"{Colors.BOLD}Example Prometheus Queries:{Colors.RESET}")
    print(f"   Lambda Invocations:")
    print(f"   {Colors.CYAN}sum(rate(aws_lambda_invocations_sum[5m])) by (function_name){Colors.RESET}")
    print()
    print(f"   DynamoDB Operations:")
    print(f"   {Colors.CYAN}aws_dynamodb_consumed_read_capacity_units_sum{Colors.RESET}")
    print()
    print(f"   ECS CPU Utilization:")
    print(f"   {Colors.CYAN}avg(aws_ecs_cpu_utilization_average) by (service_name){Colors.RESET}")
    print()

    # Cost information
    print(f"{Colors.BOLD}Cost Estimate:{Colors.RESET}")
    print(f"   ADOT Stack: ~$85-90/month")
    print(f"   - Grafana (ECS):      ~$15/month")
    print(f"   - Prometheus (ECS):   ~$30/month")
    print(f"   - ADOT Collector:     ~$15/month")
    print(f"   - Load Balancer:      ~$20/month")
    print(f"   - EFS Storage:        ~$5-10/month")
    print()

    return True


def load_state(project_root: str) -> dict:
    """Load state from file"""
    state_file = os.path.join(project_root, '.monitoring-state.json')
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {'current_scenario': None, 'sink_arn': None}


def save_state(project_root: str, current_scenario: Optional[int], sink_arn: Optional[str]):
    """Save state to file"""
    state_file = os.path.join(project_root, '.monitoring-state.json')
    try:
        with open(state_file, 'w') as f:
            json.dump({
                'current_scenario': current_scenario,
                'sink_arn': sink_arn,
                'last_updated': time.time()
            }, f, indent=2)
    except Exception as e:
        print_warning(f"Failed to save state: {e}")


def main():
    """Main entry point"""
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    print_header("AWS Monitoring Test Script")
    print_info(f"Project root: {project_root}")

    # Load configuration
    try:
        config = load_config()
        print_success("Configuration loaded")
        print_info(f"Monitoring Account: {config.monitoring_account_id}")
        print_info(f"Application Account: {config.application_account_id}")
    except Exception as e:
        print_error(f"Failed to load configuration: {e}")
        sys.exit(1)

    # Build project once
    if not build_project(project_root):
        print_error("Initial build failed. Please fix errors and try again.")
        sys.exit(1)

    # Load previous state
    state = load_state(project_root)
    sink_arn = state.get('sink_arn')
    current_scenario = state.get('current_scenario')

    if current_scenario:
        print_info(f"Restored previous session: Scenario {current_scenario}")

    scenarios = {
        1: ("Minimal", "Scenario1MinimalStack"),
        2: ("Cross-Account", "Scenario2CrossAccountStack"),
        3: ("Full Stack", "Scenario3FullStackStack"),
        4: ("Custom Metrics", "Scenario4CustomMetricsStack"),
        5: ("Multi-Service", "Scenario5MultiServiceStack"),
        6: ("Minimal Cross-Account", "Scenario6MinimalCrossAccountStack")
    }

    while True:
        show_menu()

        if current_scenario:
            print(f"{Colors.GREEN}Current scenario: {current_scenario}{Colors.RESET}")
        if sink_arn:
            print(f"{Colors.GREEN}Monitoring account deployed ✓{Colors.RESET}")

        choice = input(f"\n{Colors.BOLD}Select option: {Colors.RESET}").strip()

        if choice.lower() == 'q':
            print_info("Exiting...")
            break

        elif choice == '0':
            # Ask about Container Insights
            response = input(f"{Colors.YELLOW}Enable Container Insights for ECS cluster? (y/n, default=y): {Colors.RESET}").lower()
            enable_ci = response != 'n'

            sink_arn = deploy_monitoring_account(config, project_root, enable_adot=False, enable_container_insights=enable_ci)
            if sink_arn:
                print_success(f"Monitoring account ready. Sink ARN saved.")
                save_state(project_root, current_scenario, sink_arn)
            time.sleep(2)

        elif choice.upper() == 'A':
            print_warning("ADOT deployment includes:")
            print_info("  • AWS Distro for OpenTelemetry Collector (ECS Fargate)")
            print_info("  • Prometheus (self-hosted on ECS)")
            print_info("  • Grafana (self-hosted on ECS)")
            print_info("  • Additional costs: ECS Fargate + EFS storage")
            response = input(f"{Colors.YELLOW}Continue? (y/n): {Colors.RESET}").lower()
            if response == 'y':
                # Ask about Container Insights
                ci_response = input(f"{Colors.YELLOW}Enable Container Insights for ECS cluster? (y/n, default=y): {Colors.RESET}").lower()
                enable_ci = ci_response != 'n'

                sink_arn = deploy_monitoring_account(config, project_root, enable_adot=True, enable_container_insights=enable_ci)
                if sink_arn:
                    print_success(f"Monitoring account with ADOT ready. Sink ARN saved.")
                    save_state(project_root, current_scenario, sink_arn)
            time.sleep(2)

        elif choice in ['1', '2', '3', '4', '5', '6']:
            scenario_num = int(choice)
            scenario_name, stack_class = scenarios[scenario_num]

            # Scenarios 2 and 6 require sink ARN
            if scenario_num in [2, 6] and not sink_arn:
                print_error(f"Scenario {scenario_num} requires monitoring account to be deployed first (option 0 or A)")
                time.sleep(2)
                continue

            # Offer sink ARN for other scenarios (1, 3, 4, 5)
            use_sink = False
            if scenario_num not in [2, 6] and sink_arn:
                response = input(f"{Colors.YELLOW}Use cross-account monitoring? (y/n): {Colors.RESET}").lower()
                use_sink = response == 'y'

            if deploy_scenario(scenario_num, scenario_name, stack_class, config, project_root,
                             sink_arn if (scenario_num in [2, 6] or use_sink) else None):
                current_scenario = scenario_num
                save_state(project_root, current_scenario, sink_arn)
                print_info(f"Current scenario set to: {scenario_num}")
            time.sleep(2)

        elif choice == 't':
            if current_scenario:
                test_scenario(current_scenario, config)
            else:
                print_warning("No scenario deployed yet")
            time.sleep(2)

        elif choice.lower() == 'l':
            stacks = list_deployed_stacks(config)
            if stacks:
                print_success(f"\nFound {len(stacks)} stack(s):")
                print(f"\n{Colors.BOLD}{'Stack Name':<45} {'Account':<15} {'Status':<25}{Colors.RESET}")
                print(f"{Colors.CYAN}{'─'*90}{Colors.RESET}")
                for stack in stacks:
                    print(f"{stack['name']:<45} {stack['account']:<15} {stack['status']:<25}")
                print(f"{Colors.CYAN}{'─'*90}{Colors.RESET}")
            else:
                print_warning("No stacks found")
            input(f"\n{Colors.YELLOW}Press Enter to continue...{Colors.RESET}")

        elif choice.lower() == 't':
            if current_scenario:
                test_scenario(current_scenario, config)
            else:
                print_warning("No scenario deployed yet")
            time.sleep(2)

        elif choice.lower() == 'g':
            if current_scenario:
                print_info(f"Generating load for Scenario {current_scenario}")
                duration = input(f"{Colors.YELLOW}Duration in minutes (default=5): {Colors.RESET}").strip()
                if not duration:
                    duration = 5
                else:
                    try:
                        duration = int(duration)
                        if duration < 1 or duration > 30:
                            print_error("Duration must be between 1 and 30 minutes")
                            time.sleep(2)
                            continue
                    except ValueError:
                        print_error("Invalid duration")
                        time.sleep(2)
                        continue

                print_warning(f"This will run for {duration} minutes and generate AWS API calls (may incur small costs)")
                response = input(f"{Colors.YELLOW}Continue? (y/n): {Colors.RESET}").lower()
                if response == 'y':
                    generate_load(current_scenario, config, duration)
            else:
                print_warning("No scenario deployed yet. Deploy a scenario first (options 1-5)")
            time.sleep(2)

        elif choice.upper() == 'G':
            show_grafana_info(config)
            input(f"\n{Colors.YELLOW}Press Enter to continue...{Colors.RESET}")

        elif choice.upper() == 'D':
            interactive_destroy_stacks(config, project_root)
            # Refresh state
            stacks = list_deployed_stacks(config)
            has_monitoring = any('MonitoringAccountStack' in s['name'] for s in stacks)
            if not has_monitoring:
                sink_arn = None
            # Check if current scenario still exists
            if current_scenario:
                scenario_exists = any(f'Scenario{current_scenario}Stack' in s['name'] for s in stacks)
                if not scenario_exists:
                    current_scenario = None
            save_state(project_root, current_scenario, sink_arn)
            time.sleep(2)

        elif choice.lower() == 'd':
            if current_scenario:
                if destroy_scenario(current_scenario, config, project_root):
                    current_scenario = None
                    save_state(project_root, current_scenario, sink_arn)
            else:
                print_warning("No scenario to destroy")
            time.sleep(2)

        elif choice.upper() == 'M':
            if destroy_monitoring_account(config, project_root):
                sink_arn = None
                save_state(project_root, current_scenario, sink_arn)
            time.sleep(2)

        else:
            print_warning("Invalid option")
            time.sleep(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Interrupted by user{Colors.RESET}")
        sys.exit(0)
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
