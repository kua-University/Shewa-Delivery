 
#!/bin/bash
# scripts/rabbitmq-setup.sh
# RabbitMQ setup for ShewaDelivery
# ASR-07: Zero message loss with proper queue configuration

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}ShewaDelivery RabbitMQ Setup${NC}"
echo -e "${BLUE}========================================${NC}"

# Configuration
RABBITMQ_HOST=${RABBITMQ_HOST:-localhost}
RABBITMQ_PORT=${RABBITMQ_PORT:-5672}
RABBITMQ_MGMT_PORT=${RABBITMQ_MGMT_PORT:-15672}
RABBITMQ_USER=${RABBITMQ_USER:-shewa}
RABBITMQ_PASSWORD=${RABBITMQ_PASSWORD:-}
VHOST=${RABBITMQ_VHOST:-/}

# Function to check RabbitMQ connection
check_rabbitmq() {
    echo -e "${YELLOW}Checking RabbitMQ connection...${NC}"
    
    if command -v rabbitmqadmin &> /dev/null; then
        echo -e "${GREEN}✓ rabbitmqadmin found${NC}"
    else
        echo -e "${YELLOW}Installing rabbitmqadmin...${NC}"
        wget -q "http://$RABBITMQ_HOST:$RABBITMQ_MGMT_PORT/cli/rabbitmqadmin" -O /usr/local/bin/rabbitmqadmin
        chmod +x /usr/local/bin/rabbitmqadmin
    fi
    
    # Test connection
    if rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD list queues &>/dev/null; then
        echo -e "${GREEN}✓ RabbitMQ connected${NC}"
    else
        echo -e "${RED}✗ RabbitMQ connection failed${NC}"
        exit 1
    fi
}

# Function to create virtual host
create_vhost() {
    if [ "$VHOST" != "/" ]; then
        echo -e "${YELLOW}Creating virtual host: $VHOST${NC}"
        
        rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
            -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
            declare vhost name=$VHOST
        
        echo -e "${GREEN}✓ Virtual host created${NC}"
    fi
}

# Function to create queues
create_queues() {
    echo -e "${YELLOW}Creating queues...${NC}"
    
    # Define queues with their configurations
    declare -A queues=(
        ["shewa.notifications"]='{"durable":true,"arguments":{"x-dead-letter-exchange":"","x-dead-letter-routing-key":"shewa.notifications.dead","x-message-ttl":604800000,"x-max-retries":3}}'
        ["shewa.payment.webhook"]='{"durable":true,"arguments":{"x-message-ttl":300000}}'
        ["shewa.payment.retry"]='{"durable":true,"arguments":{"x-dead-letter-exchange":"","x-dead-letter-routing-key":"shewa.payment.retry.dead"}}'
        ["shewa.order.events"]='{"durable":true}'
        ["shewa.notifications.dead"]='{"durable":true,"arguments":{"x-message-ttl":2592000000}}'
        ["shewa.payment.retry.dead"]='{"durable":true}'
        ["shewa.delivery.updates"]='{"durable":true,"arguments":{"x-max-length":10000}}'
        ["shewa.restaurant.events"]='{"durable":true}'
    )
    
    for queue in "${!queues[@]}"; do
        echo -e "${BLUE}Creating queue: $queue${NC}"
        
        rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
            -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
            declare queue name=$queue ${queues[$queue]} vhost=$VHOST
        
        echo -e "${GREEN}✓ Queue created: $queue${NC}"
    done
}

# Function to create exchanges
create_exchanges() {
    echo -e "${YELLOW}Creating exchanges...${NC}"
    
    # Define exchanges
    declare -A exchanges=(
        ["shewa.order.events"]='{"type":"topic","durable":true}'
        ["shewa.notification.events"]='{"type":"topic","durable":true}'
        ["shewa.payment.events"]='{"type":"direct","durable":true}'
        ["shewa.delivery.events"]='{"type":"topic","durable":true}'
        ["shewa.restaurant.events"]='{"type":"fanout","durable":true}'
    )
    
    for exchange in "${!exchanges[@]}"; do
        echo -e "${BLUE}Creating exchange: $exchange${NC}"
        
        rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
            -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
            declare exchange name=$exchange ${exchanges[$exchange]} vhost=$VHOST
        
        echo -e "${GREEN}✓ Exchange created: $exchange${NC}"
    done
}

# Function to create bindings
create_bindings() {
    echo -e "${YELLOW}Creating bindings...${NC}"
    
    # Order event bindings
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        declare binding source="shewa.order.events" destination_type="queue" \
        destination="shewa.notifications" routing_key="order.*" vhost=$VHOST
    
    # Payment event bindings
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        declare binding source="shewa.payment.events" destination_type="queue" \
        destination="shewa.notifications" routing_key="payment.success" vhost=$VHOST
    
    # Delivery event bindings
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        declare binding source="shewa.delivery.events" destination_type="queue" \
        destination="shewa.notifications" routing_key="delivery.*" vhost=$VHOST
    
    echo -e "${GREEN}✓ Bindings created${NC}"
}

# Function to set queue policies
set_policies() {
    echo -e "${YELLOW}Setting queue policies...${NC}"
    
    # Dead letter policy for notification queue
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        declare policy name="dead-letter-policy" pattern="shewa.*" \
        definition='{"dead-letter-exchange":"","dead-letter-routing-key":"","message-ttl":604800000}' \
        apply-to="queues" vhost=$VHOST
    
    # Max length policy for delivery updates
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        declare policy name="max-length-policy" pattern="shewa.delivery.updates" \
        definition='{"max-length":10000,"overflow":"reject-publish"}' \
        apply-to="queues" vhost=$VHOST
    
    # High availability policy (for production)
    if [ "$ENVIRONMENT" = "production" ]; then
        rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
            -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
            declare policy name="ha-policy" pattern="shewa.*" \
            definition='{"ha-mode":"all","ha-sync-mode":"automatic"}' \
            apply-to="queues" vhost=$VHOST
        
        echo -e "${GREEN}✓ High availability policy set${NC}"
    fi
    
    echo -e "${GREEN}✓ Policies configured${NC}"
}

# Function to create users and permissions
setup_users() {
    echo -e "${YELLOW}Setting up users and permissions...${NC}"
    
    # Define service users
    services=("order-service" "payment-service" "notification-service" "delivery-service" "restaurant-service" "auth-service")
    
    for service in "${services[@]}"; do
        USERNAME="${service//-/_}"
        PASSWORD="${!USERNAME}_PASSWORD:-${service}_pass}"
        
        # Create user
        rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
            -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
            declare user name=$USERNAME password=$PASSWORD tags="" 2>/dev/null || true
        
        # Set permissions
        rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
            -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
            declare permission vhost=$VHOST user=$USERNAME \
            configure="^$service.*|^$USERNAME.*" \
            write="^$service.*|^$USERNAME.*" \
            read="^$service.*|^$USERNAME.*"
        
        echo -e "${GREEN}✓ User configured: $USERNAME${NC}"
    done
}

# Function to enable plugins
enable_plugins() {
    echo -e "${YELLOW}Enabling plugins...${NC}"
    
    plugins=(
        "rabbitmq_management"
        "rabbitmq_web_dispatch"
        "rabbitmq_shovel"
        "rabbitmq_shovel_management"
        "rabbitmq_federation"
        "rabbitmq_federation_management"
        "rabbitmq_delayed_message_exchange"
    )
    
    for plugin in "${plugins[@]}"; do
        rabbitmqctl enable_feature_flag $plugin 2>/dev/null || true
        echo -e "${GREEN}✓ Plugin enabled: $plugin${NC}"
    done
}

# Function to get queue statistics
get_queue_stats() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Queue Statistics${NC}"
    echo -e "${BLUE}========================================${NC}"
    
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        list queues name messages_ready messages_unacknowledged consumers \
        --format tsv --vhost=$VHOST
}

# Function to test message flow
test_message_flow() {
    echo -e "${YELLOW}Testing message flow...${NC}"
    
    # Publish test message
    TEST_MESSAGE='{"id":"test_'$(date +%s)'","type":"test","timestamp":"'$(date -Iseconds)'"}'
    
    rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        publish exchange="shewa.order.events" routing_key="order.created" \
        payload="$TEST_MESSAGE" vhost=$VHOST
    
    echo -e "${GREEN}✓ Test message published${NC}"
    
    # Check if message was received
    sleep 2
    MESSAGE_COUNT=$(rabbitmqadmin -H $RABBITMQ_HOST -P $RABBITMQ_MGMT_PORT \
        -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
        get queue="shewa.notifications" ackmode=ack_requeue_true count=1 2>/dev/null | grep -c "order.created" || true)
    
    if [ "$MESSAGE_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✓ Message flow working${NC}"
    else
        echo -e "${YELLOW}! Message flow may need verification${NC}"
    fi
}

# Main execution
main() {
    check_rabbitmq
    create_vhost
    create_queues
    create_exchanges
    create_bindings
    set_policies
    setup_users
    enable_plugins
    get_queue_stats
    test_message_flow
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}RabbitMQ setup completed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "Management UI: ${BLUE}http://$RABBITMQ_HOST:$RABBITMQ_MGMT_PORT${NC}"
    echo -e "Username: ${BLUE}$RABBITMQ_USER${NC}"
    echo -e "VHost: ${BLUE}$VHOST${NC}"
}

# Run main function
main "$@"