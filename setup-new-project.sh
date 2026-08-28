#!/bin/bash
set -e

# ==============================================================================
# 100% Terraform Infrastructure Provisioning & Firebase App Deployment
# ==============================================================================

if [ -z "$1" ]; then
    echo "❌ Error: Project ID is required."
    echo "Usage: ./setup-new-project.sh <PROJECT_ID> [BILLING_ACCOUNT_ID]"
    echo "Example: ./setup-new-project.sh it114115-dev-2026 01C74C-667DFE-538DBC"
    exit 1
fi

PROJECT_ID="$1"
BILLING_ACCOUNT="${2:-01C74C-667DFE-538DBC}"

echo "=========================================================="
echo "📦 Step 1: Provisioning Infrastructure for $PROJECT_ID (Terraform)"
echo "=========================================================="

cd terraform

terraform init -reconfigure

terraform apply -auto-approve \
    -state="${PROJECT_ID}.tfstate" \
    -var="project_id=$PROJECT_ID" \
    -var="billing_account=$BILLING_ACCOUNT" \
    -var="create_project=true"

cd ..

# Snapshot .env for this project
cp web-app/.env "web-app/.env.${PROJECT_ID}"

echo "=========================================================="
echo "🚀 Step 2: Deploying Multi-Codebase Functions & Hosting"
echo "=========================================================="

firebase use --add "$PROJECT_ID" --alias default || firebase use "$PROJECT_ID"

./deploy.sh

echo "=========================================================="
echo "🌱 Step 3: Seeding Initial Demo Users, Class & Prompts"
echo "=========================================================="

GOOGLE_CLOUD_PROJECT="$PROJECT_ID" node admin/scripts/seed_initial_data.mjs "$PROJECT_ID" || true

echo "=========================================================="
echo "🎉 Setup and Deployment Completed Successfully!"
echo "🌐 Live App: https://$PROJECT_ID.web.app"
echo "⚙️ Console:  https://console.firebase.google.com/project/$PROJECT_ID/overview"
echo "=========================================================="
