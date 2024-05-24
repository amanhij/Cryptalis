import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { EventEmitter } from 'events';
import { RAYDIUM_PROGRAM_ID } from '../helpers/constants';
import { fetchOwnedTokenMints, logger } from '../helpers';
import { BotConfig } from '../bot';
import { OHLC, setOhlc } from '../cache/price.cache';
import { executeTradingSignals } from '../trading-signals';
import { shyftQueryLpByBaseAndQuoteMint } from '../helpers/shyfy';
import { updateSubscriptions } from './bds.ws';

export class Listeners extends EventEmitter {
  private subscriptions: number[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly botConfig: BotConfig
  ) {
    super();
  }

  public async start(config: {
    walletPublicKey: PublicKey;
    quoteToken: Token;
    autoSell: boolean;
    cacheNewMarkets: boolean;
  }) {
    if (config.cacheNewMarkets) {
      const openBookSubscription = await this.subscribeToOpenBookMarkets(config);
      this.subscriptions.push(openBookSubscription);
    }

    const raydiumSubscription = await this.subscribeToRaydiumPools(config);
    this.subscriptions.push(raydiumSubscription);

    if (config.autoSell) {
      const walletSubscription = await this.subscribeToWalletChanges(config);
      this.subscriptions.push(walletSubscription);
    }

    const birdeyeSubscription = await this.subscribeToPriceFeed();
  }

  private async subscribeToOpenBookMarkets(config: { quoteToken: Token }) {
    return this.connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID.OPENBOOK_MARKET,
      async (updatedAccountInfo) => {
        this.emit('market', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: MARKET_STATE_LAYOUT_V3.span },
        {
          memcmp: {
            offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
      ],
    );
  }

  private async subscribeToRaydiumPools(config: { quoteToken: Token }) {
    return this.connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo) => {
        this.emit('pool', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: RAYDIUM_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
    );
  }

  private async subscribeToWalletChanges(config: { walletPublicKey: PublicKey, quoteToken: Token }) {

    // // Emit current owned tokens on start to sell
    // // TODO: Set the poolCashe for the baseMint and quoteMint
    // const tokenAccounts = await this.connection.getTokenAccountsByOwner(
    //   config.walletPublicKey,
    //   { programId: TOKEN_PROGRAM_ID },
    // );

    // for (const tokenAcc of tokenAccounts.value) {
    //   // get token account of the wallet
    //   const accountInfo = await this.connection.getAccountInfo(tokenAcc.pubkey);

    //   const keyedAccountInfo: KeyedAccountInfo = {
    //     accountId: tokenAcc.pubkey,
    //     accountInfo: accountInfo!,
    //   };

    //   this.emit('wallet', keyedAccountInfo);
    // }

    return this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        this.emit('wallet', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: config.walletPublicKey.toBase58(),
          },
        },
      ],
    );
  }

  private async subscribeToPriceFeed() {
    // 1. Fetch all token mints owned by the wallet
    const baseMints = await fetchOwnedTokenMints(this.connection, this.botConfig.wallet.publicKey, this.botConfig.quoteToken.mint);

    // 2. Fetch Pool Ids for each token mint
    const poolIds = await shyftQueryLpByBaseAndQuoteMint(baseMints, this.botConfig.quoteToken.mint.toBase58());

    // 3. Subscribe to price feed for each Pool Id
    await updateSubscriptions(poolIds);
  }

  public async stop() {
    for (let i = this.subscriptions.length; i >= 0; --i) {
      const subscription = this.subscriptions[i];
      await this.connection.removeAccountChangeListener(subscription);
      this.subscriptions.splice(i, 1);
    }
  }
}
