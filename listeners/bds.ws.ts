///
/// Birdeye Data Services websocket client
//

import { logger } from '../helpers/logger'
import { setOhlc } from "../cache/price.cache"
///
const CHAIN = 'solana'
const TOKEN = '422b22e47c4f48cfbab4d2dcd41695ee'

const socket = new WebSocket(`wss://public-api.birdeye.so/socket/${CHAIN}?x-api-key=${TOKEN}`, 'echo-protocol');
// message is received
socket.addEventListener("message", event => {
  const json = JSON.parse(event.data)
  if (json.type === 'ERROR') {
    logger.error(json.data, 'Birdeye Data Services error')
  }
  else if (json.type === 'PRICE_DATA') {
    logger.debug(json.data, 'Birdeye Data Services price data')
    const poolId = json.data.address
    const timestamp = json.data.unixTime
    const ohlc = {
      o: json.data.o,
      h: json.data.h,
      l: json.data.l,
      c: json.data.c
    }
    setOhlc(poolId, timestamp, ohlc)
  }
});

let isConnected = false

// socket opened
socket.addEventListener("open", event => {
  isConnected = true
});

// socket closed
socket.addEventListener("close", event => {
  console.log("Disconnected", event.code, event.reason);
});

// error handler
socket.addEventListener("error", event => {
  console.error("Error", event);
});


process.on('exit', () => {
  socket.close();
});


export async function updateSubscriptions(poolIds: string[]) {
  if (!poolIds || !poolIds.length) {
    return
  }
  // TODO: remove after testing
  poolIds.push('ehg3bac9v7hiaklvwktukkhecrsxpilgkfi6pmmvdglt')
  poolIds.push('A8WteoYJdxxir2zN7oGKe27e8xfZyq2C9xUW2vNJXWJt')
  poolIds.push('dCKpSj1rAxs3ad7ctMLYRHkts6Mp7AgEE5zMoWRc99J')
  poolIds.push('H4fpN2Wj6SgpFfyjhxfZS9uS2sCcgvyxqwUFWJsSwz8B')
  poolIds.push('95Lx3vGzaFLKejVdKJF8oYSMti2xBCLwxG5xDsWSkGhy')
  poolIds.push('5SjvWMynck6xtXUuZZ2e8BHK1ExSc9pHm8KNFasdALum')
  poolIds.push('GtMkWg2GqcjEV653jv9QLLjqibpL4F2X2FMkgiyb5v5H')
  poolIds.push('DcjdZb4vXkgMSL4Y1HNMW2cdicMWQQ2GPbiwSYnfrJD5')
  poolIds.push('F8ruD94rddMjVYvecZ7ghsZTdWLE2dLWDpaG83UVXQB4')
  poolIds.push('DfRDde26CrjjbyxCeDnT5dtKapn13Lx2XnQYrK4Qxf9N')
  poolIds.push('4E6q7eJE6vBNdquqzYYi5gvzd5MNpwiQKhjbRTRQGuQd')
  poolIds.push('7896DcX977xMJboS6BJvgkK4sB5p2FhctJx81DntbyCX')
  poolIds.push('5Lj8oUBF8zSLb4xuRxvjDUAh8EVsWUGLmZ5HWAnq3u34')

  if (!poolIds || !poolIds.length) {
    debugger;
  }

  const query = poolIds.map(poolId => `(address = ${poolId} AND chartType = 1m AND currency = pair)`).join(" OR ")
  const msg = {
    "type": "SUBSCRIBE_PRICE",
    "data": {
        "queryType": "complex",
        "query": query
    }
  }

  console.log(`Waiting for socket to open`, Date.now())
  while (!isConnected) {
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  console.log(`Socket is open`, Date.now())

  socket.send(JSON.stringify(msg))
}