# AgentMesh

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
│  Layer 4: PAYMENT           │  x402 + USDC on Ethereum Sepolia  │
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

# 4. Deploy smart contracts to Ethereum Sepolia
pnpm deploy:contracts

# 5. Start the full stack
pnpm dev
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

## Smart Contract Addresses (Ethereum Sepolia)

| Contract | Address |
|----------|---------|
| AgentRegistry | `0x1fba036Ca0B47119a80497A4ca9Fc2328389Ff21` |
| TaskEscrow | `0x48D2311C32FECB3F36103140D26D66DffF8016d2` |
| ReputationOracle | `0x6cf44eE0db9C7beAEBeFBcfA79c3C68a8b0f9F16` |
| AuditLogger | `0x642eC9F1A7340bB607b5d065641aa3ba8A916E47` |

---

## Sponsor Integrations

| Sponsor | Integration | Component |
|---------|-------------|-----------|
| **Protocol Labs / IPFS** | Agent memory + audit log storage | `IPFSStorage.ts` |
| **Protocol Labs / Filecoin** | Long-term decision archive | `FilecoinClient.ts` |
| **Protocol Labs / libp2p** | Agent-to-agent messaging + gossipsub | `LibP2PClient.ts` |
| **Anthropic** | Orchestrator AI (claude-sonnet-4) + MCP tools | `OrchestratorAgent.ts` |
| **x402 Protocol** | Micropayment challenge-response for agent services | `x402Client.ts` |
| **Ethereum / Sepolia** | Smart contracts + USDC payments | `contracts/` |
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

See [`.env.example`](.env.example) for a sanitized baseline and use the root [`.env`](.env) for your live deployment values.

Key variables:
- `ANTHROPIC_API_KEY` — Claude API key for orchestrator
- `PRIVATE_KEY` — Ethereum wallet private key
- `CHAIN_ID` — `11155111` for Ethereum Sepolia
- `SEPOLIA_RPC_URL` — Ethereum Sepolia RPC endpoint
- `USDC_ADDRESS_SEPOLIA` — Sepolia USDC contract used by x402 pricing flows
- `OPENROUTER_API_KEY` — inference provider key for the structured autonomous system
- `LIGHTHOUSE_API_KEY` — Filecoin/Lighthouse upload key
- `LIT_NETWORK` — Lit Protocol network selection

## Vercel Deployment

Use two deploy targets:
- Deploy the dashboard from `apps/oversight-dashboard` to Vercel.
- Keep the current API server on a persistent Node host unless you refactor realtime transport away from raw WebSockets.

Recommended setup:
1. Create a Vercel project for the dashboard and set the Root Directory to `apps/oversight-dashboard`.
2. Set `VITE_API_URL` to your live API origin and `VITE_WS_URL` to its `/ws` endpoint.
3. Build locally with `pnpm --filter @agentmesh/oversight-dashboard build` before the first deploy.
4. Deploy with Git integration or the CLI: `vercel --cwd apps/oversight-dashboard` for previews and `vercel deploy --prod --cwd apps/oversight-dashboard` for production.
5. Run `apps/api-server` on a long-lived Node host with the same root `.env` values so realtime snapshots and onchain actions remain available.

Notes:
- The current Express bridge uses a native WebSocket server at `/ws`. Per Vercel's limits documentation, Vercel Functions do not act as a WebSocket server, so the API should stay on a persistent host unless you switch to SSE or a third-party realtime transport.
- For monorepo imports in the Vercel dashboard, set each project's Root Directory explicitly so installs happen once at the repo root and builds run from the correct app.

---

## License

MIT © AgentMesh Contributors
