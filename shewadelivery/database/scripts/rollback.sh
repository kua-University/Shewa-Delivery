#!/bin/bash
# database/scripts/rollback.sh
# Rollback last migration

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Rolling back last migration...${NC}"

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

# Get last migration
last_migration=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT migration_name FROM migrations ORDER BY id DESC LIMIT 1" | xargs)

if [ -z "$last_migration" ]; then
    echo -e "${RED}No migrations to rollback${NC}"
    exit 1
fi

echo -e "${YELLOW}Rolling back: $last_migration${NC}"

# Generate rollback SQL (basic version - customize per migration)
case $last_migration in
    "006_delivery_locations.sql")
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS delivery_events;
DROP TABLE IF EXISTS driver_performance;
DROP TABLE IF EXISTS driver_location_summary;
DROP TABLE IF EXISTS delivery_zones;
EOF
        ;;
    "005_refresh_tokens.sql")
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS otp_codes;
EOF
        ;;
    "004_payment_transactions.sql")
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS payment_webhook_logs;
DROP TABLE IF EXISTS payment_transactions;
EOF
        ;;
    "003_orders.sql")
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS promo_code_usage;
DROP TABLE IF EXISTS promo_codes;
DROP TABLE IF EXISTS delivery_assignments;
DROP TABLE IF EXISTS order_timeline;
DROP TABLE IF EXISTS order_status_history;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
EOF
        ;;
    "002_restaurants.sql")
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS restaurant_reviews;
DROP TABLE IF EXISTS menu_item_option_choices;
DROP TABLE IF EXISTS menu_item_options;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS menu_categories;
DROP TABLE IF EXISTS restaurants;
EOF
        ;;
    "001_users.sql")
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS user_activity_log;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_addresses;
DROP TABLE IF EXISTS users;
DROP FUNCTION IF EXISTS update_updated_at_column();
EOF
        ;;
    *)
        echo -e "${RED}No rollback script for $last_migration${NC}"
        exit 1
        ;;
esac

# Remove migration record
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "DELETE FROM migrations WHERE migration_name='$last_migration'"

echo -e "${GREEN}Rollback completed successfully!${NC}"

unset PGPASSWORD