import BN from "bn.js";


export enum TradeAction { Buy = 'buy', Sell = 'sell', }

interface SwapAmount {
  action: TradeAction;
  quoteAmount: BN;
  tokenAmount: BN;
  dateTime: Date
}

// cache for latest sell trades
const tokenSwapMap: Record<string, SwapAmount> = {};

export function getTrade(tokenAddress: string): SwapAmount | undefined {
  // TODO: For testing purposes, we are returning the same trade for all tokens
  return {
    action: TradeAction.Sell,
    quoteAmount: new BN(100),
    tokenAmount: new BN(100),
    dateTime: new Date()
  }
  
  return tokenSwapMap[tokenAddress];
}

export function setTrade(tokenAddress: string, quoteAmount: BN, tokenAmount: BN, action: TradeAction): void {
  tokenSwapMap[tokenAddress] = { quoteAmount, tokenAmount, action, dateTime: new Date()};
}

