import { Token } from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

export function getToken(token: string) {
  switch (token) {
    case 'WSOL': {
      return Token.WSOL;
    }
    case 'USDC': {
      return new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
    }
    default: {
      throw new Error(`Unsupported quote mint "${token}". Supported values are USDC and WSOL`);
    }
  }
}

export async function fetchOwnedTokenMints(connection: Connection, walletPublicKey: PublicKey, quoteMint: PublicKey) {
  const tokenAccounts = await connection.getTokenAccountsByOwner(
    walletPublicKey,
    { programId: TOKEN_PROGRAM_ID },
  );

  let mints = await Promise.all(tokenAccounts.value.map(async (tokenAccount) => {
    // get spl token address for each token account
    const parsedTokenAccount = await connection.getParsedAccountInfo(tokenAccount.pubkey);
    // @ts-ignore
    const { mint } = parsedTokenAccount?.value?.data?.parsed!.info;

    return mint;
  }))

  mints = mints.filter((mint) => mint !== quoteMint.toBase58());
  return mints;
}

export async function fethPoolIds(mints: PublicKey[]) {
  
}