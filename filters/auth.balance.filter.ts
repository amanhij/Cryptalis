import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';

/**
 * Filter to check if the pool authority SOL balance is above a certain threshold
 */
export class AuthBalanceFilter implements Filter {
  constructor(private readonly connection: Connection, private readonly tokenAuthMinBalanceSol: number) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      // Pool auth SOL balance
      const balance = await this.connection.getBalance(poolKeys.authority);
      const balanceSol = balance / 10 ** 9;

      if (balanceSol < Number(this.tokenAuthMinBalanceSol)) {
        return { ok: false, message: `🔴 Pool authority SOL balance too low: ${balanceSol} < ${this.tokenAuthMinBalanceSol} SOL` };
      }

      return { ok: true, message: `🟢 Pool authority SOL balance: ${balanceSol} > ${this.tokenAuthMinBalanceSol}` };

    } catch (e: any) {
      if (e.code == -32602) {
        return { ok: true };
      }

      logger.error({ mint: poolKeys.baseMint }, `Failed to check pool authority SOL balance: ${e}`);
    }

    return { ok: false, message: '🔴 Failed to check pool authority SOL balance' };
  }
}