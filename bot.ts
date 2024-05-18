import {
  ComputeBudgetProgram,
  Connection,
  KeyedAccountInfo,
  Keypair,
  PublicKey,
  SignatureStatus,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, DEVELOPER_MODE, logger, NETWORK, QUOTE_AMOUNT, sleep, TakeProfitType } from './helpers';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { build } from 'pino-pretty';
import { Listeners } from './listeners';

export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  burnedPercentageThreshold: number;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  useSnipeList: boolean;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: TakeProfitType;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
  highOwnershipThresholdPercentage: number;
  tokenAuthMinBalanceSol: number;
}

type TakeProfitPoint = {
  quote: BN;
  base: BN;
};

type TakeProfitPoints = Map<
  string,           // Mint/Token address
  {
    points: TakeProfitPoint[];
    // These two fields are set after the token is bought
    // for 100 WSOL, 1000 Tokens are bought, 
    // Those will be used to calculate the profit from subsequent sells
    amountToken: BN;  // Total amount of tokens after snipe/buy 1000 Tokens
    amountQuote: BN;  // Total amount of quote token used to buy 100 SOL
  }>;

export class Bot {
  private readonly poolFilters: PoolFilters;

  // snipe list
  private readonly snipeListCache?: SnipeListCache;

  // one token at the time
  private readonly mutex: Mutex;
  private sellExecutionCount = 0;
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  // take profit points
  // suppose the token is sniped and bought for 100 SOL for 1000 tokens
  // Sell the given amount of tokens at the given price points
  //=======================================================
  // quote token | 110 SOL  | 120 SOL | 130 SOL | 140 SOL | 
  // base token  | 400      |  300    |  200    | 1000    |
  //=======================================================
  private takeProfitPoints: TakeProfitPoints;

  // buys and sells
  private buys: Array<{
    base: PublicKey;
    quote: PublicKey;
    signature: string | undefined | null;
    baseAmount: bigint,
    takeProfitAmounts: Record<number, number>,
  }> = [];

  private listeners: Listeners;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {
    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;

    this.mutex = new Mutex();
    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
    }

    this.takeProfitPoints = new Map<string, { points: TakeProfitPoint[]; amountToken: BN; amountQuote: BN }>();
  }

  async validate() {
    try {
      if (!DEVELOPER_MODE) {
        await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
      }
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      if (DEVELOPER_MODE) {
        return true;
      }
      return false;
    }

    return true;
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked() || this.sellExecutionCount > 0) {
        logger.debug(
          { mint: poolState.baseMint.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return;
      }

      await this.mutex.acquire();
    }
    logger.info({ mint: poolState.baseMint.toString() }, `Buying token...`);

    try {
      let market, mintAta;

      if (DEVELOPER_MODE) {
        [market] = await Promise.all([
          this.marketStorage.get(poolState.marketId.toString()),
          // getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
        ]);
      }
      else {
        [market, mintAta] = await Promise.all([
          this.marketStorage.get(poolState.marketId.toString()),
          getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
        ]);
      }

      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      if (!this.config.useSnipeList) {
        const match = await this.filterMatch(poolKeys);

        if (!match) {
          logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
          return;
        }
      }

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          let result: {
            confirmed: boolean;
            signature?: string | null;
            error?: string | null;
          } = {
            confirmed: true,
            signature: 'fake-sign',
            error: "fake-error",
          }

          if (!DEVELOPER_MODE) {
            result = await this.swap(
              poolKeys,
              this.config.quoteAta,
              mintAta!,
              this.config.quoteToken,
              tokenOut,
              this.config.quoteAmount,
              this.config.buySlippage,
              this.config.wallet,
              'buy',
            );
          }

          if (result.confirmed) {
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed buy tx`,
            );

            if (DEVELOPER_MODE) {
              // emit fake wallet event to trigger SELL
              // const accountInfo = await getAccount(this.connection, mintAta!, this.connection.commitment);
              const dummyMintAta = new PublicKey("J4W2unSiYTCsYH6hFwuYvum43n2c1N5edteHVhsJZb5D");
              const accountInfo = await this.connection.getAccountInfo(dummyMintAta, this.connection.commitment);
              const keyedAccountInfo: KeyedAccountInfo = {
                accountId: dummyMintAta!,
                accountInfo: accountInfo!,
              };

              this.listeners.emit('wallet', keyedAccountInfo);
            }
            break;
          }

          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount) {
    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

      await this.buildTakeProfitPoints(
        rawAccount.mint,
        new BN(rawAccount.amount.toString()),
      );

      const accInfo = await this.connection.getAccountInfo(accountId, this.connection.commitment);
      const keyedAccountInfo: KeyedAccountInfo = {
        accountId,
        accountInfo: accInfo!,
      };

      const poolData = await this.poolStorage.get(rawAccount.mint.toString(), keyedAccountInfo);

      if (!poolData) {
        logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);


      await this.priceMatch(tokenAmountIn, poolKeys);

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          logger.info(
            { mint: rawAccount.mint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          let result: {
            confirmed: boolean;
            signature?: string | null;
            error?: string | null;
          } = {
            confirmed: true,
            signature: 'fake-sign',
            error: "fake-error",
          }

          if (!DEVELOPER_MODE) {
            result = await this.swap(
              poolKeys,
              accountId,
              this.config.quoteAta,
              tokenIn,
              this.config.quoteToken,
              tokenAmountIn,
              this.config.sellSlippage,
              this.config.wallet,
              'sell',
            );
          }

          if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
                mint: rawAccount.mint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            );
            break;
          }

          logger.info(
            {
              mint: rawAccount.mint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          );
        } catch (error) {
          logger.debug({ mint: rawAccount.mint.toString(), error }, `Error confirming sell transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
          ]),
        ...(direction === 'buy'
          ? [
            createAssociatedTokenAccountIdempotentInstruction(
              wallet.publicKey,
              ataOut,
              wallet.publicKey,
              tokenOut.mint,
            ),
          ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }

  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    do {
      try {
        const shouldBuy = await this.poolFilters.execute(poolKeys);

        if (shouldBuy) {
          matchCount++;

          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }

  private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return;
    }

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    // const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    // const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    // const takeProfit = this.config.quoteAmount.add(profitAmount);

    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;

    do {
      try {
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        const takeProfitPointsForMint = this.takeProfitPoints.get(poolKeys.baseMint.toString());
        if (!takeProfitPointsForMint) {
          logger.error({ mint: poolKeys.baseMint.toString() }, `Take profit points not found for mint`);
          return;
        }

        const snipedTokenAmount: TokenAmount = new TokenAmount(amountIn.token, takeProfitPointsForMint.amountQuote);
        const amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          // Use the amount of tokens bought at the snipe/buy
          amountIn: snipedTokenAmount,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut;

        // Find the token amount to sell at the given price points
        const tokenAmountToSell = await this.calculateTokenAmountToSellUsingProfitPoints(amountOut.numerator, poolKeys.baseMint);

        logger.debug(
          {
            mint: poolKeys.baseMint.toString(),
            takeProfitPointsForMint,
            stopLoss: stopLoss.toFixed(),
            amountOut: amountOut.toFixed(),
          },
          `Take profits`,
        );

        if (amountOut.lt(stopLoss)) {
          logger.debug({ mint: poolKeys.baseMint.toString() }, `Stop loss reached`);
          return; // stop loss reached sell all tokens sniped
        }
        else if (tokenAmountToSell.gt(new BN(0))) {
          logger.debug({
            mint: poolKeys.baseMint.toString(),
            tokenAmountToSell: tokenAmountToSell.toString(),
            amountOut: amountOut.toFixed(),
          }, `Selling token...`);
          return;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);
  }

  private async buildTakeProfitPoints(mint: PublicKey, amountToken: BN) {
    if (this.takeProfitPoints.has(mint.toString())) {
      return;
    }

    // Take profit points sorted in descending order in quote token (WSOL etc...)
    const points = this.config.takeProfit.map(({ ap, pp }) => {
      try {
        console.log({ ap, pp, QUOTE_AMOUNT: this.config.quoteAmount.numerator.toString(), amountToken: amountToken.toString() });
        console.log(this.config.quoteAmount.mul(pp).numerator.div(new BN(100)).add(this.config.quoteAmount.numerator).toString());

      } catch (error) {
        debugger;
        console.log(error);
      }

      const takePofitPoint: TakeProfitPoint = {
        quote: this.config.quoteAmount.mul(pp).numerator.div(new BN(100)).add(this.config.quoteAmount.numerator),
        base: amountToken.mul(new BN(ap)).div(new BN(100)),
      }

      return takePofitPoint;
    }).sort((a, b) => b.quote.sub(a.quote).toNumber());

    this.takeProfitPoints.set(mint.toString(), {
      points,
      amountToken,
      amountQuote: this.config.quoteAmount.numerator,
    });
  }

  private async calculateTokenAmountToSellUsingProfitPoints(quoteAmount: BN, mint: PublicKey): Promise<BN> {
    const takeProfitPoints = this.takeProfitPoints.get(mint.toString());

    if (!takeProfitPoints) {
      logger.error({ mint: mint.toString() }, `Take profit points not found for mint`);
      return new BN(0);
    }


    // Suppose Profit points are 110, 120, 130, 140 WSOL
    // if amountOut by selling the base token is 135 WSOL
    // the token amount to sell is 110 + 120 + 130 = 360 Tokens
    let amountToSell = takeProfitPoints.points.reduce((acc, tp) => {
      // If the amount out is greater than the take profit point, sell the base token
      // The profit point is 110 WSOL, if the amount out is 110 or greater
      if (quoteAmount.gte(tp.quote)) {
        return acc.add(tp.base); // amount of base token to sell
      }
      return acc;
    }, new BN(0));

    // If the wallet has less than the amount to sell, sell all
    const accInfo = await this.fetchTokenAccountInfo(mint, this.config.wallet.publicKey);
    if (!accInfo) {
      return new BN(0);
    }

    if (new BN(accInfo.amount.toString()).lt(amountToSell)) {
      return new BN(accInfo.amount.toString());
    }


    return amountToSell;
  }

  private async fetchTokenAccountInfo(mint: PublicKey, wallet: PublicKey) {
    const tokenAccount = await getAssociatedTokenAddress(mint, wallet);
    const accountInfo = await getAccount(this.connection, tokenAccount, this.connection.commitment);

    return accountInfo;
  }

  public setListeners(listeners: Listeners) {
    this.listeners = listeners;
  }

}
