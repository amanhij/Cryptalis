import { Filter, FilterResult } from './pool-filters';
import { Connection, PublicKey } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';
// import { gql, GraphQLClient } from "graphql-request";

import { SHYFT_API_KEY, NETWORK } from '../helpers/constants';

export class ShyftBurnFilter implements Filter {
  private readonly gqlEndpoint = `https://programs.shyft.to/v0/graphql/?api_key=${SHYFT_API_KEY}&network=${NETWORK}`;

  constructor(private readonly connection: Connection,
    private readonly burnedPercentageThreshold: number
  ) { }

  async queryLpMintInfo(address: string) {
    // See how we are only querying what we need
    const query = `
      query MyQuery ($where: Raydium_LiquidityPoolv4_bool_exp) {
    Raydium_LiquidityPoolv4(
      where: $where
    ) {
      baseMint
      lpMint
      lpReserve
    }
  }`;

    const variables = {
      where: {
        pubkey: {
          _eq: address,
        },
      },
    };

    try {

      const res = await fetch(this.gqlEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const json = await res.json();

      return json.data;

    } catch (error) {
      logger.error(`Shyft failed to query LP mint info: ${error}`);
      throw error;
    }
  }

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      /*
      This is taken from Raydium's FE code
      https://github.com/raydium-io/raydium-frontend/blob/572e4973656e899d04e30bfad1f528efbf79f975/src/pages/liquidity/add.tsx#L646
      */
      function getBurnPercentage(lpReserve: number, actualSupply: number): number {
        const maxLpSupply = Math.max(actualSupply, (lpReserve - 1));
        const burnAmt = (maxLpSupply - actualSupply)
        console.log(`burn amt: ${burnAmt}`)
        const burnPct = (burnAmt / maxLpSupply) * 100;
        return burnPct;
      }

      //Query the Shyft API to get the pool info
      const info = await this.queryLpMintInfo(poolKeys.id.toBase58());
      const lpMint = info.Raydium_LiquidityPoolv4[0].lpMint

      logger.debug({ lpMint }, `Fetching Parsed Account Info for...`);
      //Once we have the lpMint address, we need to fetch the current token supply and decimals
      const parsedAccInfo = await this.connection.getParsedAccountInfo(new PublicKey(lpMint));
      // logger.debug({ parsedAccInfo }, `Parsed Account Info for ${lpMint}`);
      // @ts-ignore
      const mintInfo = parsedAccInfo?.value?.data?.parsed?.info

      //We divide the values based on the mint decimals
      // @ts-ignore
      const lpReserve = info.Raydium_LiquidityPoolv4[0].lpReserve / Math.pow(10, mintInfo?.decimals)
      const actualSupply = mintInfo?.supply / Math.pow(10, mintInfo?.decimals)
      logger.debug({ lpMint, lpReserve, actualSupply }, `SHYFT LP Info`);

      //Calculate burn percentage
      const burnPct = getBurnPercentage(lpReserve, actualSupply)

      logger.debug({ burnPct, burnedPercentageThreshold: this.burnedPercentageThreshold }, `Pool Burn Percentage reported by Shyft`);

      if (burnPct > this.burnedPercentageThreshold) {
        return { ok: true, message: `ShyftBurnFilter -> Burned Percentage ${burnPct} > ${this.burnedPercentageThreshold}` };
      }

      return { ok: false, message: `ShyftBurnFilter -> Burned Percentage ${burnPct} < ${this.burnedPercentageThreshold}` };

    } catch (e: any) {
      if (e.code == -32602) {
        return { ok: true };
      }

      logger.error({ mint: poolKeys.baseMint }, `Shyft Failed to check if LP is burned`);
    }

    return { ok: false, message: 'Shyft Failed to check if LP is burned' };
  }
}


