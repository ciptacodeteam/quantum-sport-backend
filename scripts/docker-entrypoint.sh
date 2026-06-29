#!/bin/sh
# Exit on error but allow graceful handling for migrations
set -e

echo "🚀 Starting application entrypoint..."
echo "📋 Environment check:"
echo "   NODE_ENV: ${NODE_ENV:-not set}"
echo "   DATABASE_URL: ${DATABASE_URL:+✓ set}${DATABASE_URL:-❌ not set}"
echo "   PORT: ${PORT:-not set}"

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set!"
  echo "   Please ensure .env file exists with DB_PASSWORD set"
  exit 1
fi

# Extract host and port from DATABASE_URL for pg_isready
# Format: postgresql://user:password@host:port/database
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')

# Default to 5432 if port extraction failed
if [ -z "$DB_PORT" ]; then
  DB_PORT=5432
fi

# Use pg_isready if available
MAX_RETRIES=30
RETRY_COUNT=0

if [ -n "$DB_HOST" ] && command -v pg_isready > /dev/null 2>&1; then
  echo "   Checking database connection to ${DB_HOST}:${DB_PORT}..."
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "❌ Database connection timeout after $MAX_RETRIES attempts"
      echo "   Host: $DB_HOST:$DB_PORT"
      exit 1
    fi
    echo "   Waiting for database... (attempt $RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  done
else
  echo "⚠️  pg_isready not available, skipping connection check"
fi

echo "✅ Database is ready!"

# Run Prisma migrations
echo "🔄 Running database migrations..."
set +e  # Don't exit on migration error, handle it gracefully
bunx prisma migrate deploy
MIGRATION_EXIT=$?
set -e

if [ $MIGRATION_EXIT -eq 0 ]; then
  echo "✅ Migrations completed successfully"
else
  echo "⚠️  Migration encountered an issue (exit code: $MIGRATION_EXIT)"
  echo ""
  echo "Attempting to recover from failed migration state..."
  
  # Try to mark any failed migrations as rolled back
  set +e
  echo "UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW() WHERE finished_at IS NULL AND rolled_back_at IS NULL;" | bunx prisma db execute --stdin --url "$DATABASE_URL" 2>&1
  RECOVERY_EXIT=$?
  set -e
  
  if [ $RECOVERY_EXIT -eq 0 ]; then
    echo "✅ Cleared failed migration state"
    echo "🔄 Retrying migrations..."
    
    set +e
    bunx prisma migrate deploy
    RETRY_EXIT=$?
    set -e
    
    if [ $RETRY_EXIT -eq 0 ]; then
      echo "✅ Migrations completed after recovery"
    else
      echo "❌ Migration retry failed"
      echo ""
      echo "📝 Manual intervention required:"
      echo "   1. Check database connection and permissions"
      echo "   2. Connect to the container:"
      echo "      docker exec -it quantum-sport-app-prod sh"
      echo "   3. Check migration status:"
      echo "      bunx prisma migrate status"
      echo "   4. Manually resolve if needed"
      exit 1
    fi
  else
    echo "⚠️  Could not automatically recover, continuing anyway..."
    echo "   The application may start but database schema might be incomplete"
  fi
fi

# Generate Prisma Client (should already be generated during build)
echo "🔧 Ensuring Prisma Client is up to date..."
set +e
bunx prisma generate > /dev/null 2>&1
GENERATE_EXIT=$?
set -e

if [ $GENERATE_EXIT -ne 0 ]; then
  echo "⚠️  Prisma Client generation failed, but build-time client should exist"
fi

# Final check
echo ""
echo "✅ All initialization steps completed"
echo "🚀 Starting application on port ${PORT:-3000}..."
echo ""

# Start the application
exec "$@"

