// backend/index.js
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
const PORT = 30008;
import { ethers, isAddress, JsonRpcProvider } from 'ethers';
import { ERC20_ABI } from './erc20ABI.js';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';


const app = express();
app.use(cors());
app.use(express.json());

const provider = new JsonRpcProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`);

// --- GitHub Auth (unchanged)
app.get('/api/github/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokenRes = await axios.post(
      `https://github.com/login/oauth/access_token`,
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: 'application/json' } }
    );

    const { access_token } = tokenRes.data;
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    res.redirect(
      `${FRONTEND_URL}/github/callback?token=${access_token}&data=${encodeURIComponent(JSON.stringify(userRes.data))}`
    );
  } catch (err) {
    console.error('GitHub Auth Error:', err?.response?.data || err.message);
    res.status(500).send('GitHub auth failed');
  }
});

// --- Onchain stats with ethers.js
app.get('/api/onchain-stats', async (req, res) => {
  let { address } = req.query;

  if (!address || typeof address !== 'string' || !isAddress(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }

  try {
    address = ethers.getAddress(address); // Normalize checksum
    const balance = await provider.getBalance(address);
    const txCount = await provider.getTransactionCount(address);
    const code = await provider.getCode(address);
    const name = await provider.lookupAddress(address);
    const isContractDeployer = code !== '0x';

    // === ERC20 Token Balances ===
    const tokens = [
      { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ];

    const tokenBalances = await Promise.all(
      tokens.map(async (token) => {
        try {
          const tokenAddress = ethers.getAddress(token.address);
          const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
          const rawBalance = await contract.balanceOf(address);
          const decimals = await contract.decimals();
          return {
            symbol: token.symbol,
            balance: parseFloat(ethers.formatUnits(rawBalance, decimals)),
          };
        } catch (tokenError) {
          return {
            symbol: token.symbol,
            balance: 0,
            error: tokenError.message,
          };
        }
      })
    );

    // === NFTs === (Alchemy)
    const alchemyUrl = `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_API_KEY}/getNFTsForOwner?owner=${address}`;
    const nftRes = await axios.get(alchemyUrl);
    const nftCount = nftRes.data?.ownedNfts?.length || 0;
    const hasNFTs = nftCount > 0;

    // === DAO Voting (Snapshot) ===
    const snapshotUrl = `https://hub.snapshot.org/graphql`;
    const daoQuery = {
      query: `
        query {
          votes(where: { voter: "${address.toLowerCase()}" }) {
            id
          }
        }
      `,
    };

    let daoVotes = 0;
    try {
      const snapshotRes = await axios.post(snapshotUrl, daoQuery, {
        headers: { 'Content-Type': 'application/json' },
      });
      daoVotes = snapshotRes.data.data.votes.length;
    } catch (e) {
      console.error('Snapshot fetch error:', e.message);
    }

    // === Contract Deployments (count how many times tx.to is null) ===
    // NOTE: Infura doesn't give historical txs directly, needs indexing service.
    // We'll just check if `txCount > 0 && isContractDeployer` for heuristic.

    res.json({
      address,
      name,
      ethBalance: parseFloat(ethers.formatEther(balance)),
      txCount,
      isContractDeployer,
      contractDeployments: isContractDeployer ? 1 : 0, // rough heuristic
      tokenBalances,
      nftCount,
      hasNFTs,
      daoVotes,
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch onchain data' });
  }
});

// Add this route to handle score calculation
app.post('/api/calculate-role', async (req, res) => {
    try {
      const inputData = req.body;
  
      // Prepare data to send to Flask ML model
      const payload = {
        totalContributions: inputData.totalContributions,
        pullRequests: inputData.pullRequests,
        issues: inputData.issues,
        repositoriesContributedTo: inputData.repositoriesContributedTo,
        followers: inputData.followers,
        repositories: inputData.repositories,
        ethBalance: inputData.ethBalance,
        txCount: inputData.txCount,
        isContractDeployer: inputData.isContractDeployer,
        contractDeployments: inputData.contractDeployments,
        tokenBalances: inputData.tokenBalances,
        nftCount: inputData.nftCount,
        daoVotes: inputData.daoVotes,
        hasNFTs: inputData.hasNFTs
      };
  
      // Call your Flask ML service
      const flaskResponse = await axios.post('https://mlflaskmodel.onrender.com/predict', payload);
  
      // Pass response back to frontend
      res.json({
        role: flaskResponse.data.role,
        githubScore: flaskResponse.data.github_score,
        onchainScore: flaskResponse.data.onchain_score
      });
  
    } catch (error) {
      console.error('Error calling ML model:', error.message);
      res.status(500).json({ error: 'Failed to calculate role' });
    }
  });
  

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });