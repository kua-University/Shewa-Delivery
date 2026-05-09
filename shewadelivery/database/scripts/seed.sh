#!/bin/bash
# database/scripts/seed.sh
# Database seeder

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting ShewaDelivery Database Seeding...${NC}"

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

export PGPASSWORD=$DB_PASSWORD

# Seeds directory
SEEDS_DIR="$(dirname "$0")/../seeds"

# Run seed files
for seed in $(ls $SEEDS_DIR/*.sql | sort); do
    seed_name=$(basename "$seed")
    echo -e "${YELLOW}Seeding: $seed_name${NC}"
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$seed"
    echo -e "${GREEN}✓ Seed completed: $seed_name${NC}"
done

echo -e "${GREEN}All seeds completed successfully!${NC}"

unset PGPASSWORD