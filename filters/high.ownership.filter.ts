import { Filter, FilterResult } from './pool-filters';
import { Connection, PublicKey, TokenAccountBalancePair } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE, logger } from '../helpers';

export class HighOwnershipFilter implements Filter {

  constructor(private readonly connection: Connection) {

  }

  private static readonly RAYDIUM_AUTHORITY_V4 = new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const { lpMint, baseMint } = poolKeys;

      // Raydium authority token account
      const raydiumAuthorityTokenAccount = await this.connection.getTokenAccountsByOwner(HighOwnershipFilter.RAYDIUM_AUTHORITY_V4, { mint: poolKeys.baseMint }, this.connection.commitment);

      // consider
      let accounts = await this.connection.getTokenLargestAccounts(baseMint, this.connection.commitment)

      // Raydium authority token account has tokens, exclude it from accounts
      if (raydiumAuthorityTokenAccount.value.length) {
        // Exclude Raydium authority token account from accounts
        accounts.value = accounts.value.filter(acc => {
          const match = acc.address.toBase58() !== raydiumAuthorityTokenAccount.value[0].pubkey.toBase58();
          return match;
        });
      }

      const totalSupply = await this.connection.getTokenSupply(baseMint, this.connection.commitment);

      // Check if the top account holds more than <HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE> of the total supply
      const tokenLargestAccountsTotalAmount = accounts.value.reduce((acc: number, tokenBalancePair: TokenAccountBalancePair) => {
        return acc + (tokenBalancePair.uiAmount ? tokenBalancePair.uiAmount : 0);
      }, 0);

      const ownershipPercentage = tokenLargestAccountsTotalAmount / totalSupply.value.uiAmount! * 100;
      logger.debug({ mint: poolKeys.baseMint }, `HighOwnershipFilter -> ${accounts.value.length} accounts has ${ownershipPercentage.toFixed(1)}% of total supply.`);
      if (ownershipPercentage < HIGH_OWNERSHIP_THRESHOLD_PERCENTAGE) {
        return { ok: true, message: `${accounts.value.length} accounts has ${ownershipPercentage}% of total supply.` };
      }

      logger.info({ pool: poolKeys.id, mint: poolKeys.baseMint }, `High amount of ownership detected, ${accounts.value.length} accounts has ${ownershipPercentage.toFixed(1)}% of total supply.`);

      return { ok: false, message: `${accounts.value.length} accounts has ${ownershipPercentage}% of total supply.` };
    } catch (e: any) {
      if (e.code == -32602) {
        return { ok: true };
      }

      logger.error({ mint: poolKeys.baseMint }, `Failed to check high amount of ownership`);
    }

    return { ok: false, message: 'Failed to check high amount of ownership' };
  }
}
