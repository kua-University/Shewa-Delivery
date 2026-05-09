#!/bin/bash
# database/scripts/migrate.sh
# PostgreSQL migration runner

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting ShewaDelivery Database Migrations...${NC}"

# Load environment variables
if [ -f .env ]; then
    source .env
fi

# Database connection parameters
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-shewadelivery}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-}

# Export password for psql
export PGPASSWORD=$DB_PASSWORD

# Migration directory
MIGRATIONS_DIR="$(dirname "$0")/../migrations"

# Create migrations table if not exists
echo -e "${YELLOW}Creating migrations tracking table...${NC}"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT NOW(),
    checksum VARCHAR(64)
);
EOF

# Run migrations
for migration in $(ls $MIGRATIONS_DIR/*.sql | sort); do
    migration_name=$(basename "$migration")
    
    # Check if migration already applied
    already_applied=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM migrations WHERE migration_name='$migration_name'")
    
    if [ "$already_applied" -eq "0" ]; then
        echo -e "${GREEN}Applying migration: $migration_name${NC}"
        
        # Calculate checksum
        checksum=$(sha256sum "$migration" | cut -d' ' -f1)
        
        # Run migration within transaction
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --single-transaction -v ON_ERROR_STOP=1 -f "$migration"
        
        # Record migration
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "INSERT INTO migrations (migration_name, checksum) VALUES ('$migration_name', '$checksum')"
        
        echo -e "${GREEN}✓ Migration applied: $migration_name${NC}"
    else
        echo -e "${YELLOW}⊘ Migration already applied: $migration_name${NC}"
    fi
done

echo -e "${GREEN}All migrations completed successfully!${NC}"

# Run seeders if requested
if [ "$1" == "--seed" ]; then
    echo -e "${YELLOW}Running seeders...${NC}"
    bash "$(dirname "$0")/seed.sh"
fi

unset PGPASSWORD