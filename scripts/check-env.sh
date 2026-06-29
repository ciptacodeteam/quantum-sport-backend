#!/bin/bash

# Script to check if all required environment variables are set

echo "🔍 Checking required environment variables..."
echo ""

REQUIRED_VARS=(
  "DATABASE_URL"
  "FRONT_END_URL"
  "BASE_URL"
  "JWT_SECRET"
  "JWT_REFRESH_SECRET"
  "JWT_ISSUER"
  "JWT_AUDIENCE"
  "JWT_EXPIRES"
  "JWT_REFRESH_EXPIRES"
  "WEBHOOK_BASE_URL"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ $var is not set"
    MISSING_VARS+=("$var")
  else
    echo "✅ $var is set"
  fi
done

echo ""

if [ ${#MISSING_VARS[@]} -eq 0 ]; then
  echo "✅ All required environment variables are set!"
else
  echo "❌ Missing ${#MISSING_VARS[@]} required environment variable(s):"
  for var in "${MISSING_VARS[@]}"; do
    echo "   - $var"
  done
  echo ""
  echo "Please check your .env file"
fi

