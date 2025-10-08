# Deployment Binaries Directory

This directory contains CDK deployment entry point files that are **automatically generated** by the Python test script.

## ⚠️ Important

**DO NOT** manually create or commit deployment files to this directory.

All deployment binaries (`deploy-*.ts`) are generated dynamically by:
```bash
python3 scripts/test_scenarios.py
```

## Generated Files

The test script creates:
- `deploy-monitoring.ts` - Monitoring account stack deployment
- `deploy-scenario1.ts` through `deploy-scenario5.ts` - Application scenario deployments

These files are automatically:
- ✅ Created when you deploy a stack
- ✅ Cleaned up when you destroy a stack
- ✅ Ignored by git (see `.gitignore`)

## Why Auto-Generate?

1. **Dynamic Configuration**: Deployment files are generated with the correct account IDs, regions, and configuration from `config/accounts.config`
2. **Clean State**: Each deployment gets fresh configuration without manual file editing
3. **No Conflicts**: Avoids git conflicts from different users' account configurations
