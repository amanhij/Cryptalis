import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { EventEmitter } from 'events';
import { RAYDIUM_PROGRAM_ID } from '../helpers/constants';
import { logger } from '../helpers';
import { BotConfig } from '../bot';
import { OHLC, setOhlc } from '../cache/price.cache';
import { executeTradingSignals } from '../trading-signals';

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

  private readonly MIN_1 = 60 * 1000;

  // subscribe to price feed for the tokens in the wallet
  private async subscribeToPriceFeed() {


    const tokenAccounts = await this.connection.getTokenAccountsByOwner(
      this.botConfig.wallet.publicKey,
      { programId: TOKEN_PROGRAM_ID },
    );

    let mints = await Promise.all(tokenAccounts.value.map(async (tokenAccount) => {
      // get spl token address for each token account
      const parsedTokenAccount = await this.connection.getParsedAccountInfo(tokenAccount.pubkey);
      // @ts-ignore
      const { mint } = parsedTokenAccount?.value?.data?.parsed!.info;

      // exclude quote token
      if (mint === this.botConfig.quoteToken.mint.toBase58()) {
        return;
      }

      return mint;
    }))
    
    mints = mints.filter((mint) => mint);

    // fetch price for each token account
    for (const mint of mints) {

      try {
        const MOTH_1 = 30 * 24 * 60 * 60 * 1000;

        const from = Math.floor((Date.now() - MOTH_1) / 1000);
        const to = Math.floor(Date.now() / 1000)
        await this.fetchTokenPrice(mint, from, to);
      } catch (error) {
        logger.error(`Failed to fetch price for mint: ${mint} - ${error}`);
      }
    }

    return setInterval(async () => {
      // For each token account,
      // get price from Liquidity Pool
      for (const mint of mints) {

        try {
          const from = Date.now() - this.MIN_1;
          const to = Date.now()
          await this.fetchTokenPrice(mint, from, to);
          await executeTradingSignals();
        } catch (error) {
          logger.error(`Failed to fetch price for mint: ${mint} - ${error}`);
        }
      }
    }, this.MIN_1);
  }

  public async fetchTokenPrice(mint: string, from: number, to: number){
    const query = new URLSearchParams()
    query.append('base_address', this.botConfig.quoteToken.mint.toBase58())
    query.append('quote_address', mint)
    query.append('type', '1m')
    // query.append('time_from', Math.floor((Date.now() - this.MIN_1) / 1000).toString())
    // query.append('time_to', Math.floor(Date.now() / 1000).toString())
    query.append('time_from', from.toString())
    query.append('time_to', to.toString())
    const url = `${process.env.BIRDEYE_API}/defi/ohlcv/base_quote?${query.toString()}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.BIRDEYE_API_KEY!,
        'x-chain': 'solana'
      },

    })
    if (!res.ok) {
      console.error(res.statusText)
      throw new Error(`Failed to fetch OHLC from Birdeye API url:${url}`)
    }
    const json: any = await res.json()
    logger.debug(`Fetched OHLC for mint: ${mint} - ${json.data.items.length}`)

    json.data.items.forEach((item: any) => {
      try {
        const { o, h, l, c } = item
        const ohlc: OHLC = { o, h, l, c }
  
        setOhlc(mint, item.unixTime, ohlc)
        
      } catch (error) {
        logger.error(`Failed to set OHLC for mint: ${mint} - ${error}`);        
      }
    })

  }

  public async stop() {
    for (let i = this.subscriptions.length; i >= 0; --i) {
      const subscription = this.subscriptions[i];
      await this.connection.removeAccountChangeListener(subscription);
      this.subscriptions.splice(i, 1);
    }
  }
}
