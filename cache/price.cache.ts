import { Big } from 'trading-signals';

export type OHLC = { o: Big, h: Big, l: Big, c: Big };
// Map of Base => Timestamp => Price OHLC
const data = new Map<string, Map<number, OHLC>>();

export function setOhlc(base: string, timestamp: number, ohlc: OHLC,) {
  let baseMap = data.get(base);
  if (!baseMap) {
    data.set(base, new Map<number, OHLC>()); // Change the type to Map<number, OHLC>
    baseMap = data.get(base);
  }

  const basePriceMap = baseMap?.get(timestamp);
  if (!basePriceMap) {
    baseMap?.set(timestamp, ohlc);
  }
}

export function getOhlc(base: string): Map<number, OHLC> | undefined {
  return data.get(base);
}


export function getBaseTokens(): string[] {
  return Array.from(data.keys());
}
