 #!/bin/bash
# scripts/seed-redis-cache.sh
# Seed Redis cache with frequently accessed data
# ASR-02: Performance optimization for cached responses

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}ShewaDelivery Redis Cache Seeder${NC}"
echo -e "${BLUE}========================================${NC}"

# Configuration
REDIS_HOST=${REDIS_HOST:-localhost}
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_PASSWORD=${REDIS_PASSWORD:-}
CACHE_TTL_MENU=${CACHE_TTL_MENU:-300}
CACHE_TTL_RESTAURANTS=${CACHE_TTL_RESTAURANTS:-300}
CACHE_TTL_CITIES=${CACHE_TTL_CITIES:-3600}
CACHE_TTL_CUISINES=${CACHE_TTL_CUISINES:-3600}

# Redis CLI command
REDIS_CMD="redis-cli -h $REDIS_HOST -p $REDIS_PORT"
if [ -n "$REDIS_PASSWORD" ]; then
    REDIS_CMD="$REDIS_CMD -a $REDIS_PASSWORD"
fi

# Function to check Redis connection
check_redis() {
    echo -e "${YELLOW}Checking Redis connection...${NC}"
    if $REDIS_CMD ping &>/dev/null; then
        echo -e "${GREEN}✓ Redis connected${NC}"
    else
        echo -e "${RED}✗ Redis connection failed${NC}"
        exit 1
    fi
}

# Function to clear existing cache
clear_cache() {
    echo -e "${YELLOW}Clearing existing cache...${NC}"
    
    # Clear specific patterns instead of flush all
    $REDIS_CMD --scan --pattern "menu:*" | xargs -r $REDIS_CMD DEL
    $REDIS_CMD --scan --pattern "restaurant:*" | xargs -r $REDIS_CMD DEL
    $REDIS_CMD --scan --pattern "cuisines:*" | xargs -r $REDIS_CMD DEL
    $REDIS_CMD --scan --pattern "cities:*" | xargs -r $REDIS_CMD DEL
    
    echo -e "${GREEN}Cache cleared${NC}"
}

# Function to seed restaurant data
seed_restaurants() {
    echo -e "${YELLOW}Seeding restaurant data...${NC}"
    
    # Get restaurants from API
    if [ -n "$API_URL" ]; then
        RESTAURANTS=$(curl -s "$API_URL/restaurants?limit=100" | jq -c '.data[]')
        
        echo "$RESTAURANTS" | while read -r restaurant; do
            RESTAURANT_ID=$(echo "$restaurant" | jq -r '.id')
            CACHE_KEY="restaurant:$RESTAURANT_ID"
            
            # Cache restaurant data
            $REDIS_CMD SETEX "$CACHE_KEY" "$CACHE_TTL_RESTAURANTS" "$restaurant"
            echo -e "${GREEN}✓ Cached restaurant $RESTAURANT_ID${NC}"
            
            # Cache menu items
            MENU=$(curl -s "$API_URL/restaurants/$RESTAURANT_ID/menu" | jq -c '.data.menu')
            $REDIS_CMD SETEX "menu:$RESTAURANT_ID" "$CACHE_TTL_MENU" "$MENU"
            echo -e "${GREEN}✓ Cached menu for restaurant $RESTAURANT_ID${NC}"
        done
    else
        echo -e "${YELLOW}API_URL not set, seeding with sample data${NC}"
        
        # Sample restaurant data
        SAMPLE_RESTAURANTS='[
            {"id":1,"name":"Ethiopian Delight","city":"Addis Ababa","rating":4.5},
            {"id":2,"name":"Pizza Haven","city":"Addis Ababa","rating":4.3},
            {"id":3,"name":"Burger Stop","city":"Addis Ababa","rating":4.2}
        ]'
        
        echo "$SAMPLE_RESTAURANTS" | jq -c '.[]' | while read -r restaurant; do
            RESTAURANT_ID=$(echo "$restaurant" | jq -r '.id')
            $REDIS_CMD SETEX "restaurant:$RESTAURANT_ID" "$CACHE_TTL_RESTAURANTS" "$restaurant"
        done
    fi
    
    echo -e "${GREEN}Restaurant seeding completed${NC}"
}

# Function to seed cuisine list
seed_cuisines() {
    echo -e "${YELLOW}Seeding cuisine list...${NC}"
    
    CUISINES='[
        {"id":"ethiopian","name":"Ethiopian","icon":"🇪🇹","count":150},
        {"id":"italian","name":"Italian","icon":"🇮🇹","count":80},
        {"id":"american","name":"American","icon":"🇺🇸","count":120},
        {"id":"chinese","name":"Chinese","icon":"🇨🇳","count":60},
        {"id":"indian","name":"Indian","icon":"🇮🇳","count":45},
        {"id":"fast-food","name":"Fast Food","icon":"🍔","count":200},
        {"id":"pizza","name":"Pizza","icon":"🍕","count":90},
        {"id":"seafood","name":"Seafood","icon":"🐟","count":30}
    ]'
    
    $REDIS_CMD SETEX "cuisines:all" "$CACHE_TTL_CUISINES" "$CUISINES"
    echo -e "${GREEN}✓ Cuisine list cached${NC}"
}

# Function to seed city list
seed_cities() {
    echo -e "${YELLOW}Seeding city list...${NC}"
    
    CITIES='[
        {"name":"Addis Ababa","code":"addis_ababa","delivery_zones":12,"active_restaurants":150},
        {"name":"Bahir Dar","code":"bahir_dar","delivery_zones":9,"active_restaurants":45},
        {"name":"Dire Dawa","code":"dire_dawa","delivery_zones":6,"active_restaurants":30},
        {"name":"Mekelle","code":"mekelle","delivery_zones":6,"active_restaurants":35},
        {"name":"Gondar","code":"gondar","delivery_zones":5,"active_restaurants":25},
        {"name":"Hawassa","code":"hawassa","delivery_zones":5,"active_restaurants":28}
    ]'
    
    $REDIS_CMD SETEX "cities:all" "$CACHE_TTL_CITIES" "$CITIES"
    echo -e "${GREEN}✓ City list cached${NC}"
}

# Function to seed popular restaurants by city
seed_popular_restaurants() {
    echo -e "${YELLOW}Seeding popular restaurants by city...${NC}"
    
    CITIES=("Addis Ababa" "Bahir Dar" "Dire Dawa" "Mekelle")
    
    for city in "${CITIES[@]}"; do
        # Get top restaurants for city (simulated)
        POPULAR_RESTAURANTS='[
            {"id":1,"name":"Ethiopian Delight","rating":4.5,"delivery_time":30},
            {"id":2,"name":"Pizza Haven","rating":4.3,"delivery_time":25},
            {"id":3,"name":"Burger Stop","rating":4.2,"delivery_time":20}
        ]'
        
        CACHE_KEY="popular:restaurants:${city// /_}"
        $REDIS_CMD SETEX "$CACHE_KEY" "$CACHE_TTL_RESTAURANTS" "$POPULAR_RESTAURANTS"
        echo -e "${GREEN}✓ Cached popular restaurants for $city${NC}"
    done
}

# Function to seed session data (for testing)
seed_sessions() {
    echo -e "${YELLOW}Seeding session data...${NC}"
    
    # Sample session with 1 hour TTL
    SESSION_DATA='{"userId":1,"role":"customer","device":"mobile"}'
    $REDIS_CMD SETEX "session:test_user_123" 3600 "$SESSION_DATA"
    echo -e "${GREEN}✓ Test session created${NC}"
}

# Function to get cache statistics
get_cache_stats() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Cache Statistics${NC}"
    echo -e "${BLUE}========================================${NC}"
    
    # Count keys by pattern
    MENU_COUNT=$($REDIS_CMD --scan --pattern "menu:*" | wc -l)
    RESTAURANT_COUNT=$($REDIS_CMD --scan --pattern "restaurant:*" | wc -l)
    CUISINE_COUNT=$($REDIS_CMD --scan --pattern "cuisines:*" | wc -l)
    CITY_COUNT=$($REDIS_CMD --scan --pattern "cities:*" | wc -l)
    
    echo -e "Menu keys: ${GREEN}$MENU_COUNT${NC}"
    echo -e "Restaurant keys: ${GREEN}$RESTAURANT_COUNT${NC}"
    echo -e "Cuisine keys: ${GREEN}$CUISINE_COUNT${NC}"
    echo -e "City keys: ${GREEN}$CITY_COUNT${NC}"
    
    # Get memory info
    MEMORY_USAGE=$($REDIS_CMD INFO memory | grep "used_memory_human" | cut -d':' -f2 | tr -d '\r')
    echo -e "Memory usage: ${GREEN}$MEMORY_USAGE${NC}"
}

# Function to warm up cache for critical endpoints
warm_up_cache() {
    echo -e "${YELLOW}Warming up cache for critical endpoints...${NC}"
    
    if [ -n "$API_URL" ]; then
        # Warm up popular endpoints
        ENDPOINTS=(
            "/restaurants?city=Addis%20Ababa&limit=20"
            "/restaurants?city=Bahir%20Dar&limit=20"
            "/cuisines"
            "/cities"
        )
        
        for endpoint in "${ENDPOINTS[@]}"; do
            echo -e "${BLUE}Warming: $endpoint${NC}"
            curl -s -o /dev/null "$API_URL$endpoint"
            sleep 0.5
        done
        
        echo -e "${GREEN}Cache warmed up${NC}"
    fi
}

# Main execution
main() {
    check_redis
    clear_cache
    seed_restaurants
    seed_cuisines
    seed_cities
    seed_popular_restaurants
    seed_sessions
    warm_up_cache
    get_cache_stats
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Redis cache seeding completed!${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# Run main function
main "$@"
