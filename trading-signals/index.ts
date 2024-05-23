
import { getOhlc, getBaseTokens } from "../cache/price.cache";
import { SMA, Big } from 'trading-signals';
import { logger } from "../helpers";

// Map of last signals for each token
const lastSignals: Map<string, string> = new Map();

export async function executeTradingSignals() {

  logger.debug('Executing trading signals');
  // Get all tokens from the cache and generate signals accordingly
  const tokens = getBaseTokens();
  tokens.forEach(token => {
    const ohlc = getOhlc(token);
    const closePrices = Array.from(ohlc!.values()).map(ohlc => ohlc.c);
    const smaResult = SMA.getResultFromBatch(closePrices);
    const lastPrice = new Big(closePrices[closePrices.length - 1]);

    if (lastPrice.gt(smaResult)) {
      if (lastSignals.get(token) === 'BUY') {
        return;
      }
      lastSignals.set(token, 'BUY');
      logger.debug({token, price: lastPrice.toString(), sma: smaResult.toString()}, `Buy signal for ${token}`);
    } else {
      if (lastSignals.get(token) === 'SELL') {
        return;
      }
      lastSignals.set(token, 'SELL');
      logger.debug({token, price: lastPrice.toString(), sma: smaResult.toString()}, `Sell signal for ${token}`);

    }
  });
}