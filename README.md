# Decentralized Identity & Digital Asset Ownership Platform

A privacy-preserving, enterprise-grade decentralized platform for managing self-sovereign digital identities (DIDs), verifiable document asset ownership, cryptographically delegated access, and dead-man-switch inheritance on an EVM blockchain.

---

## 📌 Problem Statement

- **Centralized Vulnerabilities:** Centralized identity and document registries present single points of failure prone to credential stuffing, insider leaks, and unauthorized surveillance.
- **Lack of Cryptographic Non-Repudiation:** Traditional platforms rely on weak password authentication and centralized database flags that can be silently altered or revoked without verifiable proof.
- **Fragmented Access & Inheritance:** Individuals lack granular, time-bounded methods to delegate verifiable access or securely pass digital assets to beneficiaries without trusting centralized custodial intermediaries.

---

## 💡 Our Solution

A hybrid Web3 architecture pairing client-side cryptographic security with on-chain immutability:

- **Self-Sovereign Identity (DID):** Decentralized identifiers anchored on-chain with passkey/WebAuthn hardware biometric authentication (zero master passwords or seed-phrase leak risks).
- **Verifiable Asset Ownership:** Client-side document encryption with Merkle-tree cryptographic integrity proofs permanently stamped to smart contracts.
- **Granular Access Delegation:** Time-locked and scoped access rights delegated cryptographically with step-up verification for critical actions.
- **Trustless Digital Inheritance:** Automated dead-man-switch protocols allowing beneficiaries to claim assigned assets after an inactivity threshold, verified cryptographically.
- **High-Performance Hybrid Architecture:** Local/Atlas MongoDB for fast query indexing, metadata storage, and audit trail caching; EVM smart contracts for root-of-trust settlement.

---

## 🏗️ System Architecture

```
SIH_2026/
├── blockchain-module/   # Solidity smart contracts, Foundry test suite & deployment scripts
├── backend-module/      # Express.js REST API, Ethers.js blockchain gateway, DID & Merkle engine
├── database/            # MongoDB schemas, Atlas connection configs & repository indexing
└── Frontend_Module/     # React 19 + Vite + Tailwind CSS responsive web portal
```

---

## 🚀 Quickstart: Running Locally

### Prerequisites

Ensure you have the following installed on your system:
- **[Node.js](https://nodejs.org/)** (v18 or higher)
- **[Foundry](https://book.getfoundry.sh/getting-started/installation)** (`anvil` and `forge`)
- **[MongoDB](https://www.mongodb.com/try/download/community)** (Running locally on port `27017` or a MongoDB Atlas URI)
- **[Git](https://git-scm.com/)**

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/Anubhav-Singhal-05/SIH_2026.git
cd SIH_2026
```

---

### Step 2: Start the Local Blockchain Node

Open a new terminal and start Foundry's local EVM node:

```bash
anvil --port 8545
```
*Keep this terminal running. Anvil provides instant mining and 10 pre-funded test accounts.*

---

### Step 3: Deploy Smart Contracts

In a second terminal, deploy the contracts to your local Anvil chain:

```bash
cd blockchain-module
forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cd ..
```
*(The contract addresses will match the preconfigured `deployments/anvil.json` automatically).*

---

### Step 4: Configure & Start the Backend

In your terminal, navigate to the backend module and start the server:

```bash
cd backend-module
npm install
npm start
```
*The API gateway starts at `http://localhost:3000` connected to MongoDB and the local blockchain.*

---

### Step 5: Start the Frontend Portal

In another terminal, launch the web application:

```bash
cd Frontend_Module
npm install
npm run dev
```
*Open your browser and navigate to `http://localhost:5173` to interact with the platform.*

---

# Team Details
**Team Name**: 404 Founders

**Team Members:**
- **Anubhav Singhal** - 2023UCS1518 - [Anubhav-Singhal-05](https://github.com/Anubhav-Singhal-05)
- **Shyam Kumar** - 2023UCS1509 - [SniperXyZ011](https://github.com/SniperXyZ011)
- **Abhimanyu Mittal** - 2023UCS1524 - [Abhimanyu-Mittal-12](https://github.com/Abhimanyu-Mittal-12)
- **Vanshika** - 2023UCS1529 - [Vanshikag11](https://github.com/Vanshikag11)
- **Keshav Verma** - 2023UCS1536 - [keshav-v2004](https://github.com/keshav-v2004)
- **Shivam** - 2023UCS1583 - [Shivam17-ai](https://github.com/Shivam17-ai)