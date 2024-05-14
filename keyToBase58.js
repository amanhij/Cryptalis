const fs = require('fs');
const {Keypair} = require('@solana/web3.js');
const bs58 = require('bs58');

// Replace with the path to your keypair.json file
const keypairPath = './bot-keypair.json';

const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf-8'))));
console.log(bs58.encode(keypair.secretKey));