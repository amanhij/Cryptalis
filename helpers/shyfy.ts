import { SHYFT_API_KEY, NETWORK } from '../helpers/constants';
import { logger } from '../helpers';
import { PublicKey } from '@solana/web3.js';

const gqlEndpoint = `https://programs.shyft.to/v0/graphql/?api_key=${SHYFT_API_KEY}&network=${NETWORK}`;

export async function shyftQueryLpMintInfo(poolId: string) {
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
        _eq: poolId,
      },
    },
  };

  try {

    const res = await fetch(gqlEndpoint, {
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
    // @ts-ignore
    logger.error(`Shyft failed to query LP mint info: ${error}`);
    throw error;
  }
}

export async function shyftQueryLpByBaseAndQuoteMint(baseMints: string[], quoteMint: string): Promise<string[]> {
  const query = `
    query MyQuery ($where: Raydium_LiquidityPoolv4_bool_exp) {
  Raydium_LiquidityPoolv4(
    where: $where
  ) {
    pubkey
  }
}`;

  const variables = {
    where: {
      baseMint: {
        _in: baseMints,
      },
      quoteMint: {
        _eq: quoteMint,
      },
    },
  };

  try {

    const res = await fetch(gqlEndpoint, {
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
    const poolIds = json.data.Raydium_LiquidityPoolv4.map((pool: { pubkey: string }) => pool.pubkey);

    return poolIds;

  } catch (error) {
    // @ts-ignore
    logger.error(`Shyft failed to query LP by mint: ${error}`);
    throw error;
  }
}

export async function shyftQueryLpByToken(base: string, quote: string):
  Promise<PublicKey> {
  // Get all proposalsV2 accounts
  const query = `
    query MyQuery($where: Raydium_LiquidityPoolv4_bool_exp) {
  Raydium_LiquidityPoolv4(
    where: $where
  ) {
    pubkey
  }
}`;

  //Tokens can be either baseMint or quoteMint, so we will check for both with an _or operator
  const variables = {
    where: {
      _and: [
        { baseMint: { _eq: base } },
        { quoteMint: { _eq: quote } },
      ]
    }
  };

  const res = await fetch(gqlEndpoint, {
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
  const pools = json.data.Raydium_LiquidityPoolv4
  if (pools.length === 0) {
    throw new Error(`No LP found for token pair: ${base}/${quote}`);
  }
  if (pools.length > 1) {
    throw new Error(`Multiple LPs found for token pair: ${base}/${quote}`);
  }

  return new PublicKey(pools[0].pubkey);

}