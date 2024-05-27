import { LIQUIDITY_STATE_LAYOUT_V4, LiquidityStateV4, WSOL } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';
import { Connection, KeyedAccountInfo, PublicKey } from '@solana/web3.js';
import { shyftQueryLpByToken } from '../helpers/shyfy';
import BN from 'bn.js';

export class PoolCache {
  constructor(private readonly connection: Connection) {}
  private readonly keys: Map<string, { id: string; state: LiquidityStateV4 | any }> = new Map<string, { id: string; state: LiquidityStateV4 }>();

  public async save(id: string, state: LiquidityStateV4) {
    if (!this.keys.has(state.baseMint.toString())) {
      logger.trace(`Caching new pool for mint: ${state.baseMint.toString()}`);
      this.keys.set(state.baseMint.toString(), { id, state });
    }
  }

  public async get(mint: string, cached: boolean = false): Promise<{ id: string; state: LiquidityStateV4 }> {
    if (!this.keys.has(mint) && cached) {
      // Get Pool ID
      const poolId = await shyftQueryLpByToken(mint, WSOL.mint)
      const info = await this.connection.getAccountInfo(poolId);

      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(info!.data);
      this.keys.set(mint, { id: poolId.toBase58(), state: poolState });
    }

    return this.keys.get(mint)!;
  }
}
