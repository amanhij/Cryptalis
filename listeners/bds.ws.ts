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
  console.log(event.data);
  const json = JSON.parse(event.data)
  if (json.type === 'ERROR') {
    logger.error(json.data, 'Birdeye Data Services error')
  }
  else if (json.type === 'PRICE_DATA') {
    console.log(json.data, new Date(json.data.unixTime * 1000))
    //setOhlc(json.data)
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
    debugger;
  }

  // const query = poolIds.map(poolId => `(address = ${poolId} AND chartType = 1m AND currency = pair)`).join(' OR ')
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