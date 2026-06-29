#!/bin/sh
# Docker init script for PostgreSQL

set -e

echo "Initializing PostgreSQL database..."

# Create additional databases if needed
# psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
#     CREATE DATABASE quantum_sport_test;
# EOSQL

echo "PostgreSQL initialization complete."
