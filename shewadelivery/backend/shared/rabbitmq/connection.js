 // backend/shared/rabbitmq/connection.js
const amqp = require('amqplib');
const EventEmitter = require('events');

class RabbitMQConnection extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.queues = new Map();
    this.exchanges = new Map();
  }

  /**
   * Initialize RabbitMQ connection
   */
  async connect() {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    
    try {
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // Handle connection events
      this.connection.on('error', (error) => {
        console.error('RabbitMQ connection error:', error);
        this.isConnected = false;
        this.emit('error', error);
      });
      
      this.connection.on('close', () => {
        console.warn('RabbitMQ connection closed');
        this.isConnected = false;
        this.emit('close');
        this.reconnect();
      });
      
      console.log('RabbitMQ connected successfully');
      this.emit('connected');
      
      return true;
      
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error.message);
      this.isConnected = false;
      this.reconnect();
      return false;
    }
  }

  /**
   * Reconnect with exponential backoff
   */
  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('max_reconnect_attempts');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting to RabbitMQ in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      await this.connect();
    }, delay);
  }

  /**
   * Assert a queue (create if not exists)
   */
  async assertQueue(queueName, options = {}) {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    
    const defaultOptions = {
      durable: true,
      exclusive: false,
      autoDelete: false,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': `${queueName}.dead`,
        'x-message-ttl': 7 * 24 * 60 * 60 * 1000, // 7 days
        'x-max-retries': 3
      }
    };
    
    const queueOptions = { ...defaultOptions, ...options };
    
    const queue = await this.channel.assertQueue(queueName, queueOptions);
    this.queues.set(queueName, queue);
    
    console.log(`Queue asserted: ${queueName}`);
    return queue;
  }

  /**
   * Assert an exchange
   */
  async assertExchange(exchangeName, type = 'topic', options = {}) {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    
    const defaultOptions = {
      durable: true,
      autoDelete: false
    };
    
    const exchangeOptions = { ...defaultOptions, ...options };
    
    await this.channel.assertExchange(exchangeName, type, exchangeOptions);
    this.exchanges.set(exchangeName, { type, options: exchangeOptions });
    
    console.log(`Exchange asserted: ${exchangeName} (${type})`);
    return true;
  }

  /**
   * Bind queue to exchange
   */
  async bindQueue(queueName, exchangeName, routingKey = '') {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    
    await this.channel.bindQueue(queueName, exchangeName, routingKey);
    console.log(`Queue ${queueName} bound to ${exchangeName} with routing key: ${routingKey}`);
    return true;
  }

  /**
   * Publish message to exchange
   */
  async publish(exchangeName, routingKey, message, options = {}) {
    if (!this.channel || !this.isConnected) {
      console.error('Cannot publish: RabbitMQ not connected');
      return false;
    }
    
    try {
      const defaultOptions = {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now()
      };
      
      const publishOptions = { ...defaultOptions, ...options };
      const content = Buffer.from(JSON.stringify(message));
      
      const published = this.channel.publish(
        exchangeName,
        routingKey,
        content,
        publishOptions
      );
      
      if (!published) {
        console.warn(`Message not published to ${exchangeName}:${routingKey} - buffer full`);
      }
      
      return published;
      
    } catch (error) {
      console.error('Failed to publish message:', error);
      return false;
    }
  }

  /**
   * Send message to queue
   */
  async sendToQueue(queueName, message, options = {}) {
    if (!this.channel || !this.isConnected) {
      console.error('Cannot send: RabbitMQ not connected');
      return false;
    }
    
    try {
      const defaultOptions = {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now()
      };
      
      const sendOptions = { ...defaultOptions, ...options };
      const content = Buffer.from(JSON.stringify(message));
      
      const sent = this.channel.sendToQueue(queueName, content, sendOptions);
      
      if (!sent) {
        console.warn(`Message not sent to ${queueName} - buffer full`);
      }
      
      return sent;
      
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  /**
   * Consume messages from queue
   */
  async consume(queueName, onMessage, options = {}) {
    if (!this.channel || !this.isConnected) {
      throw new Error('RabbitMQ channel not available');
    }
    
    const defaultOptions = {
      noAck: false,
      prefetch: 10
    };
    
    const consumeOptions = { ...defaultOptions, ...options };
    
    // Set prefetch limit
    await this.channel.prefetch(consumeOptions.prefetch);
    
    // Start consuming
    await this.channel.consume(queueName, async (message) => {
      if (!message) return;
      
      try {
        const content = JSON.parse(message.content.toString());
        await onMessage(content, message);
        this.channel.ack(message);
      } catch (error) {
        console.error('Error processing message:', error);
        
        // Check if we should requeue
        const shouldRequeue = message.properties.headers?.['x-retry-count'] < 3;
        this.channel.nack(message, false, shouldRequeue);
      }
    }, { noAck: consumeOptions.noAck });
    
    console.log(`Consuming from queue: ${queueName}`);
    return true;
  }

  /**
   * Create dead letter queue for failed messages
   */
  async createDeadLetterQueue(queueName) {
    const deadLetterQueue = `${queueName}.dead`;
    
    await this.assertQueue(deadLetterQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': 30 * 24 * 60 * 60 * 1000 // 30 days
      }
    });
    
    console.log(`Dead letter queue created: ${deadLetterQueue}`);
    return deadLetterQueue;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName) {
    if (!this.channel) {
      return null;
    }
    
    try {
      const queue = await this.channel.checkQueue(queueName);
      return {
        name: queueName,
        messageCount: queue.messageCount,
        consumerCount: queue.consumerCount,
        isConnected: this.isConnected
      };
    } catch (error) {
      console.error(`Failed to get stats for queue ${queueName}:`, error);
      return null;
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      console.log('RabbitMQ connection closed');
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    }
  }

  /**
   * Check connection health
   */
  isHealthy() {
    return this.isConnected && this.channel !== null;
  }
}

// Singleton instance
const rabbitmq = new RabbitMQConnection();

// Auto-connect on module load
rabbitmq.connect().catch(console.error);

module.exports = rabbitmq;
