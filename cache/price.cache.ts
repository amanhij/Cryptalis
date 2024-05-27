import { Big } from 'trading-signals';
import fs from 'fs';

export type OHLC = { o: Big, h: Big, l: Big, c: Big };
// Map of Pool Id => Timestamp => Price OHLC
let data = new Map<string, Map<number, OHLC>>();

export function setOhlc(poolId: string, timestamp: number, ohlc: OHLC,) {
  let poolMap = data.get(poolId);
  if (!poolMap) {
    data.set(poolId, new Map<number, OHLC>()); // Change the type to Map<number, OHLC>
    poolMap = data.get(poolId);
  }

  const poolPriceMap = poolMap?.get(timestamp);
  if (!poolPriceMap) {
    poolMap?.set(timestamp, ohlc);
  }

  saveDataToFile('price.cache.json', data);
}

export function getOhlc(poolId: string): Map<number, OHLC> | undefined {
  return data.get(poolId);
}


export function getBaseTokens(): string[] {
  return Array.from(data.keys());
}


// Function to convert the Map to a JSON-serializable object
function mapToObject(map: Map<string, Map<number, OHLC>>) {
  const obj: any = {};
  map.forEach((innerMap, key) => {
      obj[key] = {};
      innerMap.forEach((ohlc, timestamp) => {
          obj[key][timestamp] = {
              o: ohlc.o.toString(),
              h: ohlc.h.toString(),
              l: ohlc.l.toString(),
              c: ohlc.c.toString()
          };
      });
  });
  return obj;
}

// Function to convert the JSON-serializable object back to a Map
function objectToMap(obj: any): Map<string, Map<number, OHLC>> {
  const map = new Map<string, Map<number, OHLC>>();
  Object.keys(obj).forEach(key => {
      const innerMap = new Map<number, OHLC>();
      Object.keys(obj[key]).forEach(timestamp => {
          const ohlc = obj[key][timestamp];
          innerMap.set(Number(timestamp), {
              o: new Big(ohlc.o),
              h: new Big(ohlc.h),
              l: new Big(ohlc.l),
              c: new Big(ohlc.c)
          });
      });
      map.set(key, innerMap);
  });
  return map;
}

// Function to save the data to a file
function saveDataToFile(filePath: string, data: Map<string, Map<number, OHLC>>) {
  const obj = mapToObject(data);
  const jsonString = JSON.stringify(obj, null, 2);
  fs.writeFileSync(filePath, jsonString);
}

// Function to load the data from a file
function loadDataFromFile(filePath: string): Map<string, Map<number, OHLC>> {
  const jsonString = fs.readFileSync(filePath, 'utf-8');
  const obj = JSON.parse(jsonString);
  return objectToMap(obj);
}
