import express from 'express';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Load ABIs
const AGTabiFile = fs.readFileSync(path.join(__dirname, '../abi/AgentToken.json'), 'utf8');
const AGT_ABI = JSON.parse(AGTabiFile).AgentToken;
const AGTabiToken = fs.readFileSync(path.join(__dirname, '../abi/RoleBadgeNFT.json'), 'utf8');
const NFT_ABI = JSON.parse(AGTabiToken).RoleBadgeNFT;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tokenContract = new ethers.Contract(process.env.AGT_TOKEN_ADDRESS, AGT_ABI, wallet);
const nftContract = new ethers.Contract(process.env.ROLE_BADGE_NFT_ADDRESS, NFT_ABI, wallet);

router.post('/', async (req, res) => {
  try {
    const { address, role, ipfsCid } = req.body;
    
    // Validate input
    if (!address || !role || !ipfsCid) {
      return res.status(400).json({ success: false, error: 'Address, role, and ipfsCid are required' });
    }
    
    // First, burn tokens from the address
    const burnAmount = ethers.parseUnits("8", 18);
    const burnTx = await tokenContract.burnFrom(address, burnAmount);
    await burnTx.wait();
    
    // Then mint the NFT badge
    const tokenURI = `ipfs://${ipfsCid}`;
    const mintTx = await nftContract.mintBadge(address, tokenURI);
    const mintReceipt = await mintTx.wait();
    
    // Extract token ID from the BadgeMinted event
  const latestTokenCounter = await nftContract.tokenCounter();
  const tokenId = (latestTokenCounter - 1n).toString();

    res.json({ 
      success: true, 
      burnTxHash: burnTx.hash,
      mintTxHash: mintTx.hash,
      tokenId: tokenId,
      openSeaUrl: `https://testnets.opensea.io/assets/sepolia/${process.env.ROLE_BADGE_NFT_ADDRESS}/${tokenId}`
    });
  } catch (err) {
    console.error('Error minting badge:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/check-badge', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ success: false, error: "Wallet address is required" });
  }

  try {
    const balance = await nftContract.balanceOf(address);

    if (balance > 0n) {
      // fallback method since tokenOfOwnerByIndex is not available
      const latestTokenCounter = await nftContract.tokenCounter();
      const tokenId = (latestTokenCounter - 1n).toString(); // Last minted tokenId
      
      return res.json({ success: true, hasBadge: true, tokenId });
    } else {
      return res.json({ success: true, hasBadge: false, tokenId: null });
    }
  } catch (err) {
    console.error("Error checking badge:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


export default router;