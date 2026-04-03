# AgentMesh

AgentMesh is a production-oriented autonomous agent control plane for trust-gated service procurement. It coordinates multiple agents, verifies them onchain with ERC-8004-style identity and reputation primitives, stores encrypted receipts and memory on Filecoin-backed infrastructure, and keeps a human operator in the loop whenever mission risk or payment policy requires intervention.

This codebase is prepared for the PL Genesis: Frontier of Collaboration Hackathon 2026 and is aligned to the following contested tracks:

- `AI & Robotics`
- `Impulse AI: Autonomous ML for Every App`
- `Agents With Receipts — 8004`
- `Filecoin`

## What AgentMesh Does

AgentMesh runs a full mission loop for autonomous vendor selection and settlement:

1. The public oversight dashboard starts a mission through the control-plane API.
2. The orchestrator creates a mission plan and approval policy.
3. Specialist agents collect live market context, score vendor quotes, and assess settlement risk.
4. The control plane encrypts the decision bundle, stores the mission artifact on Filecoin-backed storage, and anchors a receipt on Sepolia.
5. If the payment amount or Impulse risk score crosses policy thresholds, the system pauses for operator approval.
6. The executor settles through `TaskEscrow`, updates reputation, writes result and memory artifacts, and emits receipts the dashboard can inspect.

The result is a demoable and extensible pattern for safe autonomous systems: planning, execution, verification, real payments, real receipts, and human override.

## Architecture

```text
                                ┌──────────────────────────────┐
                                │  Vercel Frontend             │
                                │  oversight-dashboard         │
                                │  /agent.json                 │
                                └──────────────┬───────────────┘
                                               │
                                               ▼
                                ┌──────────────────────────────┐
                                │  Render Public API           │
                                │  api-server                  │
                                │  /health /ready /system      │
                                │  /agent_log.json /tasks/*    │
                                └──────────────┬───────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
          ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
          │ Private Render   │      │ Private Render   │      │ Private Render   │
          │ orchestrator     │      │ specialist       │      │ vendor           │
          │ mission planning │      │ data/compute/    │      │ live quotes      │
          │ approval policy  │      │ executor agents  │      │ multi-vendor     │
          └──────────────────┘      └──────────────────┘      └──────────────────┘
                                               │
                          ┌────────────────────┼─────────────────────┐
                          ▼                    ▼                     ▼
                ┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐
                │ Sepolia        │   │ Filecoin-backed  │   │ Impulse AI       │
                │ AgentRegistry  │   │ encrypted        │   │ settlement-risk  │
                │ TaskEscrow     │   │ artifacts/logs   │   │ inference        │
                │ ReputationOracle│  │ memory/provenance│   │                   │
                │ AuditLogger    │   └──────────────────┘   └──────────────────┘
                └────────────────┘
```

## Production Components

### Public surface

- `apps/oversight-dashboard`: React/Vite operator console with liveness, readiness, mission, approval, receipts, and memory views.
- `apps/api-server`: Express + WebSocket control plane that exposes the dashboard API and coordinates contracts, storage, ML scoring, manifests, and background hydration.

### Private service mesh

- `apps/orchestrator`: mission planning and approval-policy service.
- `apps/specialist-agents`: `DataAgent`, `ComputeAgent`, and `ExecutorAgent` behind authenticated HTTP A2A endpoints.
- `apps/vendor-agent`: authenticated vendor quote service with multiple vendor profiles.

### Shared packages

- `packages/contracts`: Solidity contracts and Hardhat tests.
- `packages/agent-sdk`: transport, storage, Filecoin, Impulse, and service client adapters.
- `packages/shared`: shared constants and typed models for manifests, artifacts, services, and risk.

## Onchain Contracts

Verified Sepolia contracts currently referenced by the project:

| Contract | Address |
| --- | --- |
| `AgentRegistry` | `0x1fba036Ca0B47119a80497A4ca9Fc2328389Ff21` |
| `TaskEscrow` | `0x48D2311C32FECB3F36103140D26D66DffF8016d2` |
| `ReputationOracle` | `0x6cf44eE0db9C7beAEBeFBcfA79c3C68a8b0f9F16` |
| `AuditLogger` | `0x642eC9F1A7340bB607b5d065641aa3ba8A916E47` |

Core onchain behaviors:

- Agent identities are registered and linked to operator wallets.
- Tasks are created and settled through `TaskEscrow`.
- Decisions are logged through `AuditLogger`.
- Reputation updates are synchronized through `ReputationOracle`.

## Filecoin and Receipt Layer

AgentMesh uses Filecoin-backed storage as the durable receipt plane for:

- mission requirements artifacts
- result artifacts
- portable memory snapshots
- encrypted decision bundles
- dataset and telemetry provenance used by the ML layer

Two storage modes are supported:

- `lighthouse`: simplest production path for IPFS/Filecoin-backed uploads and retrieval
- `filecoin-pin`: Calibration-oriented path using `filecoin-pin` for Filecoin track deployments

Every stored artifact is surfaced back into the dashboard as a receipt with a CID, lookup endpoint, and gateway URL.

## Impulse AI Integration

Impulse is used as the settlement-risk engine in the decision loop.

The `ComputeAgent` turns mission telemetry into a typed feature vector:

- budget vs negotiated price
- savings achieved
- vendor count
- vendor reputation and historical reliability
- autonomy level
- storage mode
- historical task completion and dispute counts

That feature vector is scored by Impulse when `IMPULSE_API_KEY` and `IMPULSE_DEPLOYMENT_ID` are configured. If the external deployment is unavailable, the system falls back to a deterministic heuristic so the app remains operational, but the production path is the live Impulse inference call.

The risk output is used to:

- influence vendor ranking
- gate settlement approval
- produce an auditable rationale
- persist risk inputs and outputs inside the artifact trail

## DevSpot Compatibility

The submission-compatible manifest surface is built in:

- Vercel frontend publishes `agent.json`
- API server publishes `agent_log.json`
- dashboard surfaces manifest links and receipt links for judges

## Track Alignment

| Track | How AgentMesh Aligns |
| --- | --- |
| `AI & Robotics` | Safe multi-agent system with planning, execution, verification, human kill switch, approval gates, live intent feed, and auditable receipts. |
| `Impulse AI` | Impulse-powered settlement-risk inference is part of vendor scoring and approval policy, not a detached demo model. |
| `Agents With Receipts — 8004` | Real Sepolia transactions register identities, settle tasks, log decisions, and update reputation. The system uses identity and reputation primitives with operator-wallet linkage and DevSpot manifest outputs. |
| `Filecoin` | Requirements, results, and memory are persisted as Filecoin-backed artifacts; the project supports a Calibration-oriented storage mode and exposes a working dashboard demo. |

## Why This Scores Well

### Technical execution

- background hydration prevents API startup from blocking on chain replay
- internal services use authenticated HTTP interfaces instead of local mocks
- onchain history sync uses deterministic cursors instead of unbounded replay
- the UI reflects live readiness, risk, contract receipts, and storage receipts

### Impact and usefulness

- addresses the real trust problem in agent-to-agent commerce
- gives human operators clear intervention points instead of opaque autonomy
- provides portable trust and receipt history for future agent markets

### Completeness and functionality

- control plane, dashboard, contracts, storage, risk scoring, and manifests are all wired together
- no placeholder mock routes remain in the core mission path
- private services can be deployed as real infrastructure, not just local simulations

### Scalability and future potential

- service mesh architecture cleanly separates planning, data, compute, execution, and vendors
- Filecoin-backed artifacts create portable history and lower trust dependence on any single host
- reputation-aware routing and receipt-driven trust can scale to broader agent marketplaces

## Local Development

### Requirements

- Node `20+`
- `pnpm 9+`
- a Sepolia RPC endpoint
- an operator wallet with test ETH
- Lighthouse or Filecoin Pin credentials
- optional Anthropic and Impulse credentials for the full hosted path

### Install

```bash
pnpm install
cp .env.example .env
```

### Run the stack

```bash
pnpm dev
```

Useful targeted commands:

```bash
pnpm --filter @agentmesh/api-server dev
pnpm --filter @agentmesh/orchestrator dev
pnpm --filter @agentmesh/specialist-agents dev
pnpm --filter @agentmesh/vendor-agent dev
pnpm --filter @agentmesh/oversight-dashboard dev
```

### Verify

```bash
pnpm build
pnpm test
pnpm --filter @agentmesh/contracts check:deployment
```

Latest local verification completed successfully with:

- `pnpm build`
- `pnpm test`

## Environment Contract

Use the root [`.env.example`](./.env.example) as the baseline. The most important variables are:

- `PRIVATE_KEY`
- `SEPOLIA_RPC_URL`
- `AGENT_REGISTRY_ADDRESS`
- `TASK_ESCROW_ADDRESS`
- `REPUTATION_ORACLE_ADDRESS`
- `AUDIT_LOGGER_ADDRESS`
- `FILECOIN_STORAGE_PROVIDER`
- `LIGHTHOUSE_API_KEY`
- `FILECOIN_PIN_COMMAND`
- `INTERNAL_SERVICE_API_KEY`
- `ORCHESTRATOR_SERVICE_URL`
- `SPECIALIST_SERVICE_URL`
- `VENDOR_SERVICE_URLS`
- `IMPULSE_API_KEY`
- `IMPULSE_DEPLOYMENT_ID`
- `PUBLIC_API_URL`
- `PUBLIC_DASHBOARD_URL`
- `VITE_API_URL`
- `VITE_WS_URL`

## Deployment

### Frontend on Vercel

The repo root includes [`vercel.json`](./vercel.json) configured to build `apps/oversight-dashboard` and publish `apps/oversight-dashboard/dist`.

Recommended production settings:

- `PUBLIC_DASHBOARD_URL=https://agent-mesh-os.vercel.app`
- `PUBLIC_API_URL=<your Render public API URL>`
- `VITE_API_URL=<your Render public API URL>`
- `VITE_WS_URL=<your Render WebSocket URL>`
- contract addresses and storage envs mirrored from the backend so `agent.json` stays accurate

### Backend and private mesh on Render

The repo root includes [`render.yaml`](./render.yaml) with:

- one public web service for the control plane
- three private services for orchestrator, specialist agents, and vendor agents
- Git-connected repo settings for `https://github.com/ClawdHQ/AgentMesh`

Set the `sync: false` secrets in Render before promoting the Blueprint.

## Key API Endpoints

Public control-plane endpoints:

- `GET /health`
- `GET /ready`
- `GET /system`
- `GET /agent.json`
- `GET /agent_log.json`
- `GET /artifacts/:cid`
- `POST /tasks/run`
- `POST /tasks/:taskId/approve`
- `POST /autonomy`
- `POST /halt`
- `POST /halt/resume`

## Demo Story

The strongest demo flow is:

1. Open the dashboard and show readiness for the public API plus private services.
2. Launch a mission.
3. Show the orchestrator plan, vendor quotes, and Impulse risk output.
4. Open the Filecoin-backed requirements receipt.
5. Approve the mission if the risk policy requires it.
6. Open the Sepolia settlement transaction and the resulting `agent_log.json`.
7. Show that reputation and memory changed after settlement.

## Repository Map

```text
apps/
  api-server/
  orchestrator/
  oversight-dashboard/
  specialist-agents/
  vendor-agent/

packages/
  agent-sdk/
  contracts/
  shared/
```

## Notes

- The current production payment rail is native ETH settlement through `TaskEscrow` on Sepolia.
- The system is honest about its state: if services, contracts, or storage are not configured, readiness degrades visibly instead of pretending the mesh is healthy.
- Filecoin track support is strongest when `FILECOIN_STORAGE_PROVIDER=filecoin-pin` is used against Calibration-compatible infrastructure.

## License

MIT
