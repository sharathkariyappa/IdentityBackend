import express from 'express';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

const router = express.Router();

// Load ABI (assuming it's in JSON format)
const __dirname = path.dirname(__filename);
const abiFile = fs.readFileSync(path.join(__dirname, '../abi/AgentToken.json'), 'utf8');
const AGT_ABI = JSON.parse(abiFile).AgentToken;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tokenContract = new ethers.Contract(process.env.AGT_TOKEN_ADDRESS, AGT_ABI, wallet);

router.post('/', async (req, res) => {
  try {
    const { address, amount } = req.body;
    
    // Validate input
    if (!address || !amount) {
      return res.status(400).json({ success: false, error: 'Address and amount are required' });
    }
    
    const tx = await tokenContract.mint(address, ethers.parseUnits(amount.toString(), 18));
    await tx.wait();
    
    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error('Error minting tokens:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;