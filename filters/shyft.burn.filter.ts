import { Filter, FilterResult } from './pool-filters';
import { Connection, PublicKey } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';

import { shyftQueryLpMintInfo } from '../helpers/shyfy';

export class ShyftBurnFilter implements Filter {

  constructor(private readonly connection: Connection,
    private readonly burnedPercentageThreshold: number
  ) { }


  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      /*
      This is taken from Raydium's FE code
      https://github.com/raydium-io/raydium-frontend/blob/572e4973656e899d04e30bfad1f528efbf79f975/src/pages/liquidity/add.tsx#L646
      */
      function getBurnPercentage(lpReserve: number, actualSupply: number): number {
        const maxLpSupply = Math.max(actualSupply, (lpReserve - 1));
        const burnAmt = (maxLpSupply - actualSupply);
        if (maxLpSupply <= 0) {
          return 0;
        };
        const burnPct = (burnAmt / maxLpSupply) * 100;
        return burnPct;
      }

      //Query the Shyft API to get the pool info
      const info = await shyftQueryLpMintInfo(poolKeys.id.toBase58());
      const lpMint = info.Raydium_LiquidityPoolv4[0].lpMint

      //Once we have the lpMint address, we need to fetch the current token supply and decimals
      const parsedAccInfo = await this.connection.getParsedAccountInfo(new PublicKey(lpMint));
      // logger.debug({ parsedAccInfo }, `Parsed Account Info for ${lpMint}`);
      // @ts-ignore
      const mintInfo = parsedAccInfo?.value?.data?.parsed?.info

      //We divide the values based on the mint decimals
      // @ts-ignore
      const lpReserve = info.Raydium_LiquidityPoolv4[0].lpReserve / Math.pow(10, mintInfo?.decimals)
      const actualSupply = mintInfo?.supply / Math.pow(10, mintInfo?.decimals)

      //Calculate burn percentage
      const burnPct = getBurnPercentage(lpReserve, actualSupply)


      if (burnPct > this.burnedPercentageThreshold) {
        // logger.debug({ poolId: poolKeys.id, burnPct, burnedPercentageThreshold: this.burnedPercentageThreshold }, `Pool Burn Percentage reported by Shyft`);
        return { ok: true, message: `🟢ShyftBurnFilter -> Burned Percentage ${burnPct} > ${this.burnedPercentageThreshold}` };
      }

      return { ok: false, message: `🔴 ShyftBurnFilter -> Burned Percentage ${burnPct} < ${this.burnedPercentageThreshold}` };

    } catch (e: any) {
      if (e.code == -32602) {
        return { ok: true };
      }

      logger.error({ mint: poolKeys.baseMint, err: e }, `Shyft Failed to check if LP is burned`);
    }

    return { ok: false, message: '🔴 Shyft Failed to check if LP is burned' };
  }
}


