// AgentMesh shared constants

export const AGENTMESH_VERSION = '0.1.0';

// libp2p topics
export const TOPIC_TASKS = 'agentmesh/tasks';
export const TOPIC_INTENTS = 'agentmesh/intents';
export const TOPIC_HALT = 'agentmesh/halt';
export const TOPIC_NEGOTIATION = 'agentmesh/negotiation';
export const TOPIC_PAYMENTS = 'agentmesh/payments';

// Chain IDs
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_MAINNET_CHAIN_ID = 8453;

// USDC on Base Sepolia
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// ERC-8004 capabilities
export const CAPABILITY_SUBSCRIPTION_PRICING = 'subscription_pricing';
export const CAPABILITY_FETCH_DATA = 'fetch_subscription_data';
export const CAPABILITY_FETCH_API_PRICING = 'fetch_api_pricing';
export const CAPABILITY_FETCH_USAGE_METRICS = 'fetch_usage_metrics';
export const CAPABILITY_ANALYZE_PRICING = 'analyze_pricing';
export const CAPABILITY_SCORE_VENDORS = 'score_vendors';
export const CAPABILITY_CALCULATE_SAVINGS = 'calculate_savings';
export const CAPABILITY_SIGN_TRANSACTION = 'sign_transaction';
export const CAPABILITY_SUBMIT_PAYMENT = 'submit_payment';
export const CAPABILITY_UPDATE_REGISTRY = 'update_registry';

// Task statuses
export const TASK_STATUS = {
  CREATED: 0,
  FUNDED: 1,
  ACCEPTED: 2,
  COMPLETED: 3,
  DISPUTED: 4,
  REFUNDED: 5,
} as const;

// Negotiation constants
export const MAX_NEGOTIATION_ROUNDS = 3;
export const MAX_VENDOR_DISCOUNT_PERCENT = 20;

// Reputation scoring weights
export const REPUTATION_WEIGHT_REPUTATION = 0.4;
export const REPUTATION_WEIGHT_PRICE = 0.4;
export const REPUTATION_WEIGHT_SUCCESS_RATE = 0.2;

// Autonomy levels
export const AUTONOMY_LEVELS = {
  ALWAYS_ASK: 0,
  ASK_FOR_PAYMENTS: 1,
  ASK_OVER_10: 2,
  ASK_OVER_50: 3,
  FULLY_AUTONOMOUS: 4,
} as const;

export const AUTONOMY_LEVEL_LABELS: Record<number, string> = {
  0: 'Always ask',
  1: 'Ask for payments',
  2: 'Ask >$10',
  3: 'Ask >$50',
  4: 'Fully autonomous',
};

// HTTP status codes
export const HTTP_PAYMENT_REQUIRED = 402;
export const HTTP_OK = 200;

// Memory limits
export const MAX_MEMORY_ENTRIES = 1000;
export const LRU_CACHE_SIZE = 100;

// Timeouts
export const TASK_DEFAULT_DEADLINE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const NEGOTIATION_TIMEOUT_MS = 30 * 1000; // 30 seconds
export const PAYMENT_TIMEOUT_MS = 60 * 1000; // 60 seconds
