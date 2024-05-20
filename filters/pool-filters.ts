import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { BurnFilter } from './burn.filter';
import { MutableFilter } from './mutable.filter';
import { RenouncedFreezeFilter } from './renounced.filter';
import { PoolSizeFilter } from './pool-size.filter';
import { HighOwnershipFilter } from './high.ownership.filter';
import { BURNED_PERCENTAGE_THRESHOLD, CHECK_IF_FREEZABLE, CHECK_IF_MINT_IS_RENOUNCED, CHECK_IF_MUTABLE, CHECK_IF_SOCIALS, HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE, TOKEN_AUTH_MIN_BALANCE_SOL, logger } from '../helpers';
import { ShyftBurnFilter } from './shyft.burn.filter';
import { AuthBalanceFilter } from './auth.balance.filter';

export interface Filter {
  execute(poolKeysV4: LiquidityPoolKeysV4): Promise<FilterResult>;
}

export interface FilterResult {
  ok: boolean;
  message?: string;
}

export interface PoolFilterArgs {
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
}

export class PoolFilters {
  private readonly filters: Filter[] = [];

  constructor(
    readonly connection: Connection,
    readonly args: PoolFilterArgs,
  ) {
    if (BURNED_PERCENTAGE_THRESHOLD) {
      // this.filters.push(new BurnFilter(connection, BURNED_PERCENTAGE_THRESHOLD));
      this.filters.push(new ShyftBurnFilter(connection, BURNED_PERCENTAGE_THRESHOLD));
    }

    if (CHECK_IF_MINT_IS_RENOUNCED || CHECK_IF_FREEZABLE) {
      this.filters.push(new RenouncedFreezeFilter(connection, CHECK_IF_MINT_IS_RENOUNCED, CHECK_IF_FREEZABLE));
    }

    if (CHECK_IF_MUTABLE || CHECK_IF_SOCIALS) {
      this.filters.push(new MutableFilter(connection, getMetadataAccountDataSerializer(), CHECK_IF_MUTABLE, CHECK_IF_SOCIALS));
    }

    if (!args.minPoolSize.isZero() || !args.maxPoolSize.isZero()) {
      this.filters.push(new PoolSizeFilter(connection, args.quoteToken, args.minPoolSize, args.maxPoolSize));
    }

    if(HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE) {
      this.filters.push(new HighOwnershipFilter(connection));
    }

    if(TOKEN_AUTH_MIN_BALANCE_SOL) {
      this.filters.push(new AuthBalanceFilter(connection, TOKEN_AUTH_MIN_BALANCE_SOL));
    }
  }

  public async execute(poolKeys: LiquidityPoolKeysV4): Promise<boolean> {
    if (this.filters.length === 0) {
      return true;
    }

    const result = await Promise.all(this.filters.map((f) => f.execute(poolKeys)));
    const pass = result.every((r) => r.ok);

    if (pass) {
      logger.trace(result, 'All filters passed successfully.');
      // debugger;
      return true;
    }

    for (const filterResult of result.filter((r) => !r.ok)) {
      logger.trace(filterResult.message);
    }

    return false;
  }
}
