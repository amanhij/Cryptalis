import { Logger } from 'pino';
import { Commitment } from '@solana/web3.js';
import { logger } from './logger';
import { DEVNET_PROGRAM_ID, MAINNET_PROGRAM_ID } from '@raydium-io/raydium-sdk';
import BN from 'bn.js';

const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.error(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

export interface TpSlConfig {
  tp: number;
  sl: number;
}[];

const parseTpSlConfig = (tpSlConfig: string): TpSlConfig => {
  try {
    return JSON.parse(tpSlConfig);
  } catch (error) {
    logger.error('Error parsing TP/SL config');
    process.exit(1);
  }
}

export const DEVELOPER_MODE: boolean = retrieveEnvVariable('DEVELOPER_MODE', logger) === 'true';

// Wallet
export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);

// Network
export enum SolanaNetwork {
  MainnetBeta = 'mainnet-beta',
  Devnet = 'devnet',
}

// SHYFT API
export const SHYFT_API_KEY = retrieveEnvVariable('SHYFT_API_KEY', logger);

// Connection
export const NETWORK: SolanaNetwork = retrieveEnvVariable('NETWORK', logger) as SolanaNetwork;
export const RAYDIUM_PROGRAM_ID = NETWORK === SolanaNetwork.MainnetBeta ? MAINNET_PROGRAM_ID : DEVNET_PROGRAM_ID;
export const COMMITMENT_LEVEL: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);

// Bot
export const LOG_LEVEL = retrieveEnvVariable('LOG_LEVEL', logger);
export const ONE_TOKEN_AT_A_TIME = retrieveEnvVariable('ONE_TOKEN_AT_A_TIME', logger) === 'true';
export const COMPUTE_UNIT_LIMIT = Number(retrieveEnvVariable('COMPUTE_UNIT_LIMIT', logger));
export const COMPUTE_UNIT_PRICE = Number(retrieveEnvVariable('COMPUTE_UNIT_PRICE', logger));
export const PRE_LOAD_EXISTING_MARKETS = retrieveEnvVariable('PRE_LOAD_EXISTING_MARKETS', logger) === 'true';
export const CACHE_NEW_MARKETS = retrieveEnvVariable('CACHE_NEW_MARKETS', logger) === 'true';
export const TRANSACTION_EXECUTOR = retrieveEnvVariable('TRANSACTION_EXECUTOR', logger);
export const CUSTOM_FEE = retrieveEnvVariable('CUSTOM_FEE', logger);

// Buy
export const AUTO_BUY_DELAY = Number(retrieveEnvVariable('AUTO_BUY_DELAY', logger));
export const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
export const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
export const MAX_BUY_RETRIES = Number(retrieveEnvVariable('MAX_BUY_RETRIES', logger));
export const BUY_SLIPPAGE = Number(retrieveEnvVariable('BUY_SLIPPAGE', logger));

// Sell
export const AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger) === 'true';
export const AUTO_SELL_DELAY = Number(retrieveEnvVariable('AUTO_SELL_DELAY', logger));
export const MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger));
export const TP_SL_CONFIG = parseTpSlConfig(retrieveEnvVariable('TP_SL_CONFIG', logger));
export const PRICE_CHECK_INTERVAL = Number(retrieveEnvVariable('PRICE_CHECK_INTERVAL', logger));
export const PRICE_CHECK_DURATION = Number(retrieveEnvVariable('PRICE_CHECK_DURATION', logger));
export const SELL_SLIPPAGE = Number(retrieveEnvVariable('SELL_SLIPPAGE', logger));

// Filters
export const FILTER_CHECK_INTERVAL = Number(retrieveEnvVariable('FILTER_CHECK_INTERVAL', logger));
export const FILTER_CHECK_DURATION = Number(retrieveEnvVariable('FILTER_CHECK_DURATION', logger));
export const CONSECUTIVE_FILTER_MATCHES = Number(retrieveEnvVariable('CONSECUTIVE_FILTER_MATCHES', logger));
export const CHECK_IF_MUTABLE = retrieveEnvVariable('CHECK_IF_MUTABLE', logger) === 'true';
export const CHECK_IF_SOCIALS = retrieveEnvVariable('CHECK_IF_SOCIALS', logger) === 'true';
export const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true';
export const CHECK_IF_FREEZABLE = retrieveEnvVariable('CHECK_IF_FREEZABLE', logger) === 'true';
export const BURNED_PERCENTAGE_THRESHOLD = Number(retrieveEnvVariable('BURNED_PERCENTAGE_THRESHOLD', logger));
export const MIN_POOL_SIZE = retrieveEnvVariable('MIN_POOL_SIZE', logger);
export const MAX_POOL_SIZE = retrieveEnvVariable('MAX_POOL_SIZE', logger);
export const USE_SNIPE_LIST = retrieveEnvVariable('USE_SNIPE_LIST', logger) === 'true';
export const SNIPE_LIST_REFRESH_INTERVAL = Number(retrieveEnvVariable('SNIPE_LIST_REFRESH_INTERVAL', logger));
export const HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE = Number(retrieveEnvVariable('HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE', logger));
export const TOKEN_AUTH_MIN_BALANCE_SOL = Number(retrieveEnvVariable('TOKEN_AUTH_MIN_BALANCE_SOL', logger));
export const TOKEN_PERCENTAGE_ALLOCATED_TO_POOL = Number(retrieveEnvVariable('TOKEN_PERCENTAGE_ALLOCATED_TO_POOL', logger));