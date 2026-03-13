# 🕸️ AgentMesh

**Trustless Autonomous Agent Coordination Network**

AgentMesh is an open-source framework and live platform where autonomous AI agents discover each other, negotiate tasks, pay for services, and operate under human oversight — all with cryptographic proof of every decision made.

Built for the **PL Genesis: Frontiers of Collaboration Hackathon** (AI & Robotics track, Protocol Labs).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENTMESH 5-LAYER STACK                      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: HUMAN OVERSIGHT   │  React Dashboard + Kill Switch    │
│  Layer 4: PAYMENT           │  x402 + USDC on Base Sepolia      │
│  Layer 3: IDENTITY          │  ERC-8004 + On-chain Reputation   │
│  Layer 2: COORDINATION      │  A2A Protocol + Negotiation Engine │
│  Layer 1: MESSAGING         │  libp2p + Gossipsub + Noise Enc.  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐    A2A    ┌──────────────┐    A2A    ┌─────────────┐
│ Orchestrator │◄─────────►│  Specialist  │◄─────────►│   Vendor    │
│   (Claude)   │           │   Agents     │           │   Agent     │
│              │  libp2p   │  DataAgent   │           │ (Counterpty)│
│  ReAct Loop  │◄─────────►│ ComputeAgent │           │             │
│  MCP Tools   │           │ ExecutorAgent│           │             │
└──────┬───────┘           └──────────────┘           └─────────────┘
       │                                                      │
       │         ┌─────────────────────────────┐             │
       └─────────►       DECENTRALIZED          ◄────────────┘
                 │      INFRASTRUCTURE          │
                 │  IPFS/Filecoin (Memory+Audit)│
                 │  ERC-8004 Registry           │
                 │  TaskEscrow (x402 USDC)      │
                 │  AuditLogger (Decision Proofs)│
                 └─────────────────────────────┘
                              │
                 ┌────────────▼─────────────┐
                 │    OVERSIGHT DASHBOARD   │
                 │  Intent Feed │ Kill Switch│
                 │  Audit Log  │ Pay. Flow  │
                 └─────────────────────────┘
```

---

## Quickstart (5 commands)

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables and fill in required values
cp .env.example .env

# 3. Build all packages and apps
pnpm build

# 4. Deploy smart contracts to Base Sepolia (optional — uses mocks otherwise)
pnpm deploy:contracts

# 5. Start the full stack
docker-compose up
```

Open **http://localhost:5173** to see the oversight dashboard.

---

## Demo Walkthrough

### Live Scenario: Slack Pro Subscription Optimization

1. Open `http://localhost:5173` — the oversight dashboard loads showing all 5 agents
2. Click **"▶ Run Demo"** button in the header or center panel
3. **Watch in real-time:**

   ```
   [DataAgent]     FETCHING:   Checking current Slack Pro subscription price
   [Orchestrator]  DISCOVERING: Found 3 vendor agents with subscription_pricing
   [Orchestrator]  NEGOTIATING: Round 1 — vendors start at list price
   [ComputeAgent]  COMPUTING:  Analyzing vendor pricing and reputation scores
   [Orchestrator]  NEGOTIATING: Round 2 — BetterComms Pro offers 10% discount
   [Orchestrator]  NEGOTIATING: Round 3 — Settled at $8.50/month (was $12.50)
   [Orchestrator]  AWAITING_APPROVAL: Save $48/year? → Human approval needed
   ```

4. **Approval modal appears** → Click "✓ Approve" to authorize the switch
5. **ExecutorAgent funds escrow** with USDC via x402 payment protocol
6. **Audit log** shows IPFS CID for the complete decision chain
7. **Reputation scores** updated on-chain for all participating agents
8. Click **🛑 KILL SWITCH** → all agents halt, banner shows "MESH HALTED"
9. Click **▶ RESUME MESH** → agents reload memory from IPFS and restart

---

## Repository Structure

```
agentmesh/
├── packages/
│   ├── contracts/          # Solidity smart contracts (Hardhat)
│   │   ├── AgentRegistry.sol    # ERC-8004 identity + reputation
│   │   ├── TaskEscrow.sol       # x402-compatible payment escrow
│   │   ├── ReputationOracle.sol # On-chain reputation aggregation
│   │   └── AuditLogger.sol      # Decision hash anchoring
│   ├── agent-sdk/          # TypeScript SDK for building agents
│   │   ├── BaseAgent.ts         # Abstract agent class
│   │   ├── A2AClient.ts         # Google A2A protocol
│   │   ├── x402Client.ts        # x402 payment protocol
│   │   ├── LibP2PClient.ts      # libp2p messaging
│   │   ├── IPFSStorage.ts       # IPFS memory/audit storage
│   │   └── DecisionProver.ts    # ZK-lite decision hash prover
│   └── shared/             # Shared constants, errors, utilities
│
├── apps/
│   ├── orchestrator/       # Personal AI orchestrator (Claude + ReAct)
│   ├── specialist-agents/  # DataAgent, ComputeAgent, ExecutorAgent
│   ├── vendor-agent/       # Mock vendor counterparty
│   ├── api-server/         # Express + WebSocket bridge server
│   └── oversight-dashboard/ # React 18 + Vite oversight UI
```

---

## Smart Contract Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| AgentRegistry | _Deploy with `pnpm deploy:contracts`_ |
| TaskEscrow | _Deploy with `pnpm deploy:contracts`_ |
| ReputationOracle | _Deploy with `pnpm deploy:contracts`_ |
| AuditLogger | _Deploy with `pnpm deploy:contracts`_ |

---

## Sponsor Integrations

| Sponsor | Integration | Component |
|---------|-------------|-----------|
| **Protocol Labs / IPFS** | Agent memory + audit log storage | `IPFSStorage.ts` |
| **Protocol Labs / Filecoin** | Long-term decision archive | `FilecoinClient.ts` |
| **Protocol Labs / libp2p** | Agent-to-agent messaging + gossipsub | `LibP2PClient.ts` |
| **Anthropic** | Orchestrator AI (claude-sonnet-4) + MCP tools | `OrchestratorAgent.ts` |
| **x402 Protocol** | Micropayment challenge-response for agent services | `x402Client.ts` |
| **Base / EVM** | Smart contracts + USDC payments | `contracts/` |
| **ERC-8004** | Agent identity + reputation registry | `AgentRegistry.sol` |

---

## Hackathon Judging Criteria

| Criterion | How AgentMesh Meets It |
|-----------|----------------------|
| **Technical Innovation** | 5-layer protocol stack: libp2p + A2A + x402 + ZK-lite proofs + IPFS memory |
| **AI/Robotics Integration** | Claude-powered orchestrator with ReAct loop + MCP tool registration |
| **Decentralization** | IPFS memory, on-chain registry, x402 payments, libp2p transport |
| **Human Oversight** | Real-time intent feed, kill switch, autonomy slider, approval modal |
| **Production Quality** | TypeScript strict mode, Zod validation, neverthrow, pino logging, Docker |
| **Demo-ability** | One-click demo with realistic negotiation, real IPFS CIDs, live UI |

---

## Development

```bash
# Run specific package
pnpm --filter @agentmesh/contracts test
pnpm --filter @agentmesh/agent-sdk build

# Start dev servers
pnpm dev

# Run all tests
pnpm test

# Lint
pnpm lint
```

---

## Environment Variables

See [`.env.example`](.env.example) for all required configuration.

Key variables:
- `ANTHROPIC_API_KEY` — Claude API key for orchestrator
- `PRIVATE_KEY` — Ethereum wallet private key
- `BASE_SEPOLIA_RPC_URL` — Base Sepolia RPC endpoint
- `W3_STORAGE_EMAIL` — web3.storage email for IPFS uploads

---

## License

MIT © AgentMesh Contributors
