import React, { startTransition, useEffect, useMemo, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001/ws';

type TabKey = 'overview' | 'negotiate' | 'registry' | 'audit' | 'payments' | 'memory';

type Snapshot = {
  ready: boolean;
  halted: boolean;
  blockers: string[];
  readiness: {
    state: 'idle' | 'hydrating' | 'ready' | 'error';
    lastHydratedAt?: string;
    inFlight: boolean;
    services: ServiceStatus[];
  };
  network: {
    chainId: number;
    label: string;
    registryAddress?: string;
    taskEscrowAddress?: string;
    auditLoggerAddress?: string;
    storageProvider: 'lighthouse' | 'filecoin-pin';
  };
  autonomyLevel: number;
  metrics: {
    registeredAgents: number;
    tasksCompleted: number;
    tasksAwaitingApproval: number;
    decisionsLogged: number;
    totalSettledWei: string;
    totalSavingsWei: string;
    highRiskMissions: number;
  };
  manifest: AgentManifest;
  agents: Agent[];
  intents: IntentEntry[];
  tasks: MeshTask[];
  audit: AuditEntry[];
  payments: PaymentEvent[];
  memory: MemorySnapshot[];
  agentLog: AgentLogEntry[];
};

type ServiceStatus = {
  key: string;
  url: string;
  ready: boolean;
  lastCheckedAt?: string;
  error?: string;
  agents: Array<{
    key: string;
    name: string;
    role: string;
    url: string;
    description: string;
    capabilities: string[];
  }>;
};

type AgentManifest = {
  agentId: string;
  agentName: string;
  version: string;
  description: string;
  homepage: string;
  controlPlaneUrl: string;
  dashboardUrl: string;
  agentLogUrl: string;
  capabilities: string[];
  tracks: string[];
  receipts: {
    onchainIdentityRegistry?: string;
    settlementEscrow?: string;
    auditLogger?: string;
    filecoinArtifacts?: string;
  };
  networks: {
    sepoliaChainId: number;
    filecoinCalibrationEnabled: boolean;
  };
  operatorModel: {
    humanOversight: boolean;
    haltSupported: boolean;
    approvalRequiredAbove: string;
  };
};

type AgentLogEntry = {
  id: string;
  type: 'hydration' | 'mission' | 'approval' | 'settlement' | 'audit' | 'storage' | 'error';
  title: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  taskId?: string;
  txHash?: string;
  cid?: string;
  summary?: string;
};

type Agent = {
  key: string;
  name: string;
  role: 'orchestrator' | 'data' | 'compute' | 'executor' | 'vendor';
  icon: string;
  description: string;
  capabilities: string[];
  status:
    | 'booting'
    | 'running'
    | 'thinking'
    | 'waiting_payment'
    | 'awaiting_approval'
    | 'halted'
    | 'offline';
  intent: string;
  address: string;
  reputationScore: number;
  taskCount: number;
  successRate: number;
  pricing?: {
    currency: 'ETH';
    amountWei: string;
    displayAmount: string;
  };
  onchain?: {
    agentId: number;
    owner: string;
    operatorWallet: string;
    registryAddress: string;
    registrationURI: string;
  };
  memoryCID?: string;
  lastActiveAt: number;
};

type IntentEntry = {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  description: string;
  timestamp: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
};

type MeshTask = {
  id: string;
  title: string;
  objective: string;
  status: 'draft' | 'running' | 'awaiting_approval' | 'settling' | 'completed' | 'failed' | 'halted';
  createdAt: number;
  updatedAt: number;
  autonomyLevel: number;
  budgetWei: string;
  baselinePriceWei: string;
  finalPriceWei?: string;
  savingsWei?: string;
  winnerAgentKey?: string;
  winnerAgentId?: number;
  approval?: {
    required: boolean;
    thresholdWei: string;
    reason: string;
    requestedAt: number;
  };
  vendorBids: VendorBid[];
  requirementsCID?: string;
  decisionCID?: string;
  resultCID?: string;
  aiReasoning?: string;
  missionPlan?: {
    summary: string;
    checkpoints: string[];
    approvalPolicy: string;
  };
  riskAssessment?: {
    provider: 'impulse' | 'heuristic';
    score: number;
    label: 'low' | 'medium' | 'high';
    requiresApproval: boolean;
    rationale: string;
    evaluatedAt?: string;
    deploymentId?: string;
    modelVersion?: string;
  };
  requirementsArtifact?: {
    cid: string;
    uri?: string;
    gatewayUrl: string;
    provider?: 'lighthouse' | 'filecoin-pin';
    network: 'ipfs' | 'filecoin-calibration';
  };
  resultArtifact?: {
    cid: string;
    uri?: string;
    gatewayUrl: string;
    provider?: 'lighthouse' | 'filecoin-pin';
    network: 'ipfs' | 'filecoin-calibration';
  };
  memoryArtifact?: {
    cid: string;
    uri?: string;
    gatewayUrl: string;
    provider?: 'lighthouse' | 'filecoin-pin';
    network: 'ipfs' | 'filecoin-calibration';
  };
  settlement?: {
    taskId: number;
    createTxHash: string;
    fundTxHash: string;
    acceptTxHash: string;
    completeTxHash: string;
  };
  errors: string[];
};

type VendorBid = {
  agentKey: string;
  agentName: string;
  agentId?: number;
  initialPriceWei: string;
  counterPriceWei: string;
  floorPriceWei: string;
  reputationScore: number;
  score?: number;
  reasoning?: string;
};

type AuditEntry = {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  inputHash: string;
  outputHash: string;
  ipfsCID: string;
  timestamp: string;
  txHash?: string;
};

type PaymentEvent = {
  id: string;
  from: string;
  to: string;
  amount: string;
  currency: 'ETH';
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  taskId?: string;
};

type MemorySnapshot = {
  version: number;
  cid: string;
  timestamp: number;
  summary: string;
};

const EMPTY_SNAPSHOT: Snapshot = {
  ready: false,
  halted: false,
  blockers: ['Connecting to the control plane'],
  readiness: {
    state: 'idle',
    inFlight: false,
    services: [],
  },
  network: {
    chainId: 11155111,
    label: 'Ethereum Sepolia',
    storageProvider: 'lighthouse',
  },
  autonomyLevel: 2,
  metrics: {
    registeredAgents: 0,
    tasksCompleted: 0,
    tasksAwaitingApproval: 0,
    decisionsLogged: 0,
    totalSettledWei: '0',
    totalSavingsWei: '0',
    highRiskMissions: 0,
  },
  manifest: {
    agentId: 'agentmesh-control-plane',
    agentName: 'AgentMesh',
    version: '0.1.0',
    description: 'Connecting to manifest',
    homepage: '',
    controlPlaneUrl: '',
    dashboardUrl: '',
    agentLogUrl: '',
    capabilities: [],
    tracks: [],
    receipts: {},
    networks: {
      sepoliaChainId: 11155111,
      filecoinCalibrationEnabled: false,
    },
    operatorModel: {
      humanOversight: true,
      haltSupported: true,
      approvalRequiredAbove: '0',
    },
  },
  agents: [],
  intents: [],
  tasks: [],
  audit: [],
  payments: [],
  memory: [],
  agentLog: [],
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'negotiate', label: 'Negotiate' },
  { key: 'registry', label: 'Registry' },
  { key: 'audit', label: 'Audit' },
  { key: 'payments', label: 'Payments' },
  { key: 'memory', label: 'Memory' },
];

const AUTONOMY_OPTIONS = [
  { level: 0, name: 'Always ask', description: 'Confirm every mission and settlement' },
  { level: 1, name: 'Ask for payments', description: 'Any spend requires approval' },
  { level: 2, name: 'Ask above 0.004 ETH', description: 'Small settlements may proceed automatically' },
  { level: 3, name: 'Ask above 0.02 ETH', description: 'Only high-value work pauses for approval' },
  { level: 4, name: 'Fully autonomous', description: 'The mesh may settle without interruption' },
];

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('orchestrator');
  const [missionLoading, setMissionLoading] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;

    const loadSnapshot = async () => {
      try {
        const response = await fetch(`${API_URL}/system`);
        if (!response.ok) {
          throw new Error(`Failed to fetch system snapshot (${response.status})`);
        }
        const nextSnapshot = (await response.json()) as Snapshot;
        if (!closed) {
          startTransition(() => {
            setSnapshot(nextSnapshot);
            if (!nextSnapshot.agents.some((agent) => agent.key === selectedAgentKey) && nextSnapshot.agents[0]) {
              setSelectedAgentKey(nextSnapshot.agents[0].key);
            }
          });
        }
      } catch (error) {
        if (!closed) {
          setActionError(String(error));
        }
      }
    };

    loadSnapshot().catch(() => undefined);

    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as { type: string; payload: Snapshot };
        if (message.type === 'snapshot') {
          startTransition(() => {
            setSnapshot(message.payload);
            if (!message.payload.agents.some((agent) => agent.key === selectedAgentKey) && message.payload.agents[0]) {
              setSelectedAgentKey(message.payload.agents[0].key);
            }
          });
        }
      } catch {
        // Ignore malformed websocket messages.
      }
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, [selectedAgentKey]);

  const selectedAgent = useMemo(
    () => snapshot.agents.find((agent) => agent.key === selectedAgentKey) ?? snapshot.agents[0],
    [selectedAgentKey, snapshot.agents]
  );
  const latestTask = snapshot.tasks[0];
  const latestLog = snapshot.agentLog[0];
  const vendorAgents = snapshot.agents.filter((agent) => agent.role === 'vendor');
  const activeAgents = snapshot.agents.filter((agent) => agent.status !== 'offline').length;
  const manifestReady = Boolean(snapshot.manifest.controlPlaneUrl && snapshot.manifest.agentLogUrl);

  const runMission = async () => {
    setMissionLoading(true);
    setActionError(null);
    try {
      const response = await fetch(`${API_URL}/tasks/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Production Inference Vendor Procurement',
          objective:
            'Find the best trust-adjusted registered agent vendor for production inference and autonomous settlement, negotiate the lowest executable Ethereum-denominated price, and preserve a private audit trail.',
          budgetEth: '0.015',
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Mission launch failed (${response.status})`);
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setMissionLoading(false);
    }
  };

  const approveLatestTask = async () => {
    if (!latestTask) return;
    setApprovalLoading(true);
    setActionError(null);
    try {
      const response = await fetch(`${API_URL}/tasks/${latestTask.id}/approve`, {
        method: 'POST',
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Approval failed (${response.status})`);
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setApprovalLoading(false);
    }
  };

  const toggleKill = async () => {
    setActionError(null);
    try {
      const endpoint = snapshot.halted ? `${API_URL}/halt/resume` : `${API_URL}/halt`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: snapshot.halted ? undefined : JSON.stringify({ reason: 'Operator kill switch' }),
      });
      if (!response.ok) {
        throw new Error(`Failed to ${snapshot.halted ? 'resume' : 'halt'} mesh`);
      }
    } catch (error) {
      setActionError(String(error));
    }
  };

  const updateAutonomy = async (level: number) => {
    setActionError(null);
    try {
      const response = await fetch(`${API_URL}/autonomy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update autonomy (${response.status})`);
      }
    } catch (error) {
      setActionError(String(error));
    }
  };

  return (
    <div className={`shell ${snapshot.halted ? 'is-halted' : ''}`}>
      <div className="halted-overlay" />
      <div className="halted-banner">
        MESH HALTED — ALL AGENTS SUSPENDED — USE RESUME TO RESTART THE AUTONOMOUS SYSTEM
      </div>

      <nav className="topbar">
        <div className="nav-logo">
          <div className="logo-hex" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="#7c6aff" strokeWidth="1.5" />
              <polygon points="14,7 21,11 21,17 14,21 7,17 7,11" fill="rgba(124,106,255,.2)" stroke="#a896ff" strokeWidth="1" />
              <circle cx="14" cy="14" r="2.5" fill="#7c6aff" />
            </svg>
          </div>
          <span>AgentMesh</span>
        </div>

        <div className="nav-links">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={tab.key === activeTab ? 'active' : ''}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="nav-right">
          <div className={`badge-live ${snapshot.readiness.state === 'ready' ? 'is-live' : 'is-warn'}`}>
            <span className="dot-live" />
            {snapshot.readiness.state.toUpperCase()} · {snapshot.network.label}
          </div>
          <button type="button" className={`btn-kill ${snapshot.halted ? 'halted' : ''}`} onClick={toggleKill}>
            {snapshot.halted ? '▶ RESUME MESH' : '⛔ KILL SWITCH'}
          </button>
        </div>
      </nav>

      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-section">Agents</div>
          {snapshot.agents
            .filter((agent) => agent.role !== 'vendor')
            .map((agent) => (
              <button
                key={agent.key}
                type="button"
                className={`agent-item ${selectedAgent?.key === agent.key ? 'active' : ''}`}
                onClick={() => setSelectedAgentKey(agent.key)}
              >
                <div className={`agent-avatar status-${statusClass(agent.status)}`}>{agent.icon}</div>
                <div className="agent-info">
                  <div className="agent-name">{agent.name}</div>
                  <div className="agent-intent">{agent.intent}</div>
                </div>
                <div className="agent-rep">{agent.reputationScore}</div>
              </button>
            ))}

          <div className="sidebar-divider" />
          <div className="sidebar-section">External</div>
          {vendorAgents.map((agent) => (
            <button
              key={agent.key}
              type="button"
              className={`agent-item ${selectedAgent?.key === agent.key ? 'active' : ''}`}
              onClick={() => setSelectedAgentKey(agent.key)}
            >
              <div className={`agent-avatar status-${statusClass(agent.status)}`}>{agent.icon}</div>
              <div className="agent-info">
                <div className="agent-name">{agent.name}</div>
                <div className="agent-intent">{agent.intent}</div>
              </div>
              <div className="agent-rep">{agent.reputationScore}</div>
            </button>
          ))}

          <div className="sidebar-divider" />
          <div className="sidebar-section">Network</div>
          <div className="network-card">
            <div><span>Registered</span><span>{snapshot.metrics.registeredAgents}</span></div>
            <div><span>Registry</span><span>{shortAddress(snapshot.network.registryAddress)}</span></div>
            <div><span>Escrow</span><span>{shortAddress(snapshot.network.taskEscrowAddress)}</span></div>
            <div><span>Audit</span><span>{shortAddress(snapshot.network.auditLoggerAddress)}</span></div>
            <div><span>Storage</span><span>{snapshot.network.storageProvider}</span></div>
          </div>

          <div className="sidebar-divider" />
          <div className="network-card">
            <div><span>Readiness</span><span className={snapshot.ready ? 'ok' : 'warn'}>{snapshot.readiness.state.toUpperCase()}</span></div>
            <div><span>Approval queue</span><span>{snapshot.metrics.tasksAwaitingApproval}</span></div>
            <div><span>High risk</span><span className={snapshot.metrics.highRiskMissions > 0 ? 'warn' : 'ok'}>{snapshot.metrics.highRiskMissions}</span></div>
            <div><span>Live intents</span><span>{snapshot.intents.length}</span></div>
            <div><span>Memory</span><span className={snapshot.memory[0] ? 'ok' : ''}>{snapshot.memory[0] ? 'SYNCED' : 'EMPTY'}</span></div>
          </div>

          <div className="sidebar-divider" />
          <div className="network-card">
            <div><span>Manifest</span><span className={manifestReady ? 'ok' : 'warn'}>{manifestReady ? 'READY' : 'MISSING'}</span></div>
            <div><span>Tracks</span><span>{snapshot.manifest.tracks.length}</span></div>
            <div><span>Approval</span><span>{snapshot.manifest.operatorModel.approvalRequiredAbove} ETH</span></div>
            <div><span>Receipts</span><span>{snapshot.audit.length + snapshot.payments.length}</span></div>
          </div>
        </aside>

        <main className="main">
          {activeTab === 'overview' && (
            <section className="panel active">
              <div className="main-header">
                <div className="main-title">Network Overview</div>
                <div className="main-subtitle">Structured autonomous system · onchain trust primitives · live control plane</div>
              </div>

              <div className="panel-body">
                <div className="demo-banner">
                  <div className="demo-icon">⚙</div>
                  <div className="demo-text">
                    <div className="demo-title">Launch Autonomous Vendor Procurement</div>
                    <div className="demo-desc">
                      Orchestrator discovers registered agents, ComputeAgent scores bids with OpenRouter,
                      the decision bundle is Lit-encrypted and stored to Filecoin, then settlement flows through the ERC-8004-linked TaskEscrow.
                    </div>
                    <div className="banner-foot">
                      <span className={`section-badge ${snapshot.ready ? 'badge-complete' : 'badge-pending'}`}>
                        {snapshot.ready ? 'SYSTEM READY' : 'CONFIG REQUIRED'}
                      </span>
                      {latestTask && (
                        <span className="banner-meta">
                          Latest task: <strong>{latestTask.title}</strong> · {latestTask.status.replaceAll('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button" className="demo-btn" disabled={missionLoading} onClick={runMission}>
                    {missionLoading ? 'RUNNING…' : '▶ LAUNCH'}
                  </button>
                </div>

                {(snapshot.blockers.length > 0 || actionError) && (
                  <div className="warning-card">
                    {snapshot.blockers.map((blocker) => (
                      <div key={blocker} className="warning-line">{blocker}</div>
                    ))}
                    {actionError && <div className="warning-line">{actionError}</div>}
                  </div>
                )}

                <div className="metrics-grid">
                  <MetricCard label="Active Agents" value={String(activeAgents)} delta={`${vendorAgents.length} vendors registered`} tone="purple" />
                  <MetricCard label="ETH Settled" value={`${formatEth(snapshot.metrics.totalSettledWei)} ETH`} delta="Onchain via TaskEscrow" tone="teal" />
                  <MetricCard label="Tasks Completed" value={String(snapshot.metrics.tasksCompleted)} delta={`${snapshot.metrics.tasksAwaitingApproval} awaiting approval`} tone="amber" />
                  <MetricCard label="Value Saved" value={`${formatEth(snapshot.metrics.totalSavingsWei)} ETH`} delta={`${snapshot.metrics.decisionsLogged} decisions anchored`} tone="green" />
                </div>

                <div className="two-col-grid">
                  <div className="table-card compact">
                    <div className="rp-title">Private Service Readiness</div>
                    {snapshot.readiness.services.length > 0 ? (
                      <div className="service-stack">
                        {snapshot.readiness.services.map((service) => (
                          <div key={service.key} className="service-row">
                            <div>
                              <div className="service-name">{humanizeServiceName(service.key)}</div>
                              <div className="service-meta">
                                {shortUrl(service.url)}
                                {service.lastCheckedAt ? ` · checked ${relativeIso(service.lastCheckedAt)}` : ''}
                              </div>
                              {service.error && <div className="trace-note">{service.error}</div>}
                            </div>
                            <div className={`section-badge ${service.ready ? 'badge-complete' : 'badge-pending'}`}>
                              {service.ready ? 'READY' : 'DEGRADED'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="compact-empty">No internal services discovered yet.</div>
                    )}
                  </div>

                  <div className="table-card compact">
                    <div className="rp-title">Manifest + Receipts</div>
                    <div className="trace-grid">
                      <TraceRow label="Agent ID" value={snapshot.manifest.agentId} />
                      <TraceRow label="Operator model" value={snapshot.manifest.operatorModel.humanOversight ? 'Human oversight enabled' : 'Autonomous only'} />
                      <TraceRow label="Approval threshold" value={`${snapshot.manifest.operatorModel.approvalRequiredAbove} ETH`} />
                      <TraceRow label="Filecoin mode" value={snapshot.manifest.networks.filecoinCalibrationEnabled ? 'Calibration-backed' : 'IPFS gateway'} />
                    </div>
                    <div className="manifest-links">
                      <a className="link-inline" href={`${snapshot.manifest.dashboardUrl.replace(/\/$/, '')}/agent.json`} target="_blank" rel="noreferrer">
                        `agent.json`
                      </a>
                      <a className="link-inline" href={snapshot.manifest.agentLogUrl} target="_blank" rel="noreferrer">
                        `agent_log.json`
                      </a>
                      {snapshot.manifest.controlPlaneUrl && (
                        <a className="link-inline" href={snapshot.manifest.controlPlaneUrl} target="_blank" rel="noreferrer">
                          Control plane
                        </a>
                      )}
                    </div>
                    <div className="manifest-links">
                      {snapshot.manifest.receipts.onchainIdentityRegistry && (
                        <a
                          className="link-inline"
                          href={explorerLink(snapshot.manifest.receipts.onchainIdentityRegistry, 'address')}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Identity registry
                        </a>
                      )}
                      {snapshot.manifest.receipts.settlementEscrow && (
                        <a
                          className="link-inline"
                          href={explorerLink(snapshot.manifest.receipts.settlementEscrow, 'address')}
                          target="_blank"
                          rel="noreferrer"
                        >
                          TaskEscrow
                        </a>
                      )}
                      {snapshot.manifest.receipts.auditLogger && (
                        <a
                          className="link-inline"
                          href={explorerLink(snapshot.manifest.receipts.auditLogger, 'address')}
                          target="_blank"
                          rel="noreferrer"
                        >
                          AuditLogger
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {latestLog && (
                  <div className="table-card compact">
                    <div className="rp-title">Latest Control Plane Receipt</div>
                    <div className="service-row">
                      <div>
                        <div className="service-name">{latestLog.title}</div>
                        <div className="service-meta">
                          {latestLog.type} · {relativeIso(latestLog.createdAt)}
                        </div>
                        {latestLog.summary && <div className="trace-note">{latestLog.summary}</div>}
                      </div>
                      <div className={`section-badge ${latestLog.status === 'completed' ? 'badge-complete' : latestLog.status === 'failed' ? 'badge-pending' : 'badge-active'}`}>
                        {latestLog.status.toUpperCase()}
                      </div>
                    </div>
                    <div className="manifest-links">
                      {latestLog.txHash && (
                        <a className="link-inline" href={explorerLink(latestLog.txHash)} target="_blank" rel="noreferrer">
                          Settlement tx
                        </a>
                      )}
                      {latestLog.cid && (
                        <a className="link-inline" href={artifactLookupUrl(latestLog.cid)} target="_blank" rel="noreferrer">
                          Artifact metadata
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="section-header">
                  <div className="section-title">Agent Fleet</div>
                  <div className="section-badge badge-active">{activeAgents} ONLINE</div>
                </div>

                <div className="agents-grid">
                  {snapshot.agents.map((agent) => (
                    <button
                      key={agent.key}
                      type="button"
                      className={`agent-card-full ${selectedAgent?.key === agent.key ? 'selected' : ''}`}
                      onClick={() => setSelectedAgentKey(agent.key)}
                    >
                      <div className="acf-header">
                        <div className="acf-avatar">{agent.icon}</div>
                        <div>
                          <div className="acf-name">{agent.name}</div>
                          <div className="acf-type">
                            {agent.onchain ? `ERC-8004 #${String(agent.onchain.agentId).padStart(3, '0')}` : 'Pending registration'}
                          </div>
                        </div>
                        <div className="acf-status">
                          <span className={`status-dot ${statusDot(agent.status)}`} />
                          <span>{agent.status.replaceAll('_', ' ')}</span>
                        </div>
                      </div>
                      <div className="acf-stats">
                        <StatTile label="Rep" value={String(agent.reputationScore)} />
                        <StatTile label="Tasks" value={String(agent.taskCount)} />
                        <StatTile label="Success" value={`${Math.round(agent.successRate * 100)}%`} />
                      </div>
                      <div className="acf-intent">{agent.intent}</div>
                    </button>
                  ))}
                </div>

                <div className="two-col-grid">
                  <div>
                    <div className="section-header">
                      <div className="section-title">Intent Feed</div>
                      <div className="section-badge badge-active">LIVE</div>
                    </div>
                    <div className="intent-feed">
                      {snapshot.intents.slice(0, 14).map((intent) => (
                        <div key={intent.id} className="intent-line">
                          <div className="intent-ts">{timeLabel(intent.timestamp)}</div>
                          <div className={`intent-agent tag-${tagClass(intent.agentId)}`}>{intent.agentName}</div>
                          <div className="intent-msg">
                            <strong>{intent.action}</strong> — {intent.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="section-header">
                      <div className="section-title">Agent Swarm Map</div>
                    </div>
                    <div className="swarm-map">
                      {snapshot.agents.map((agent, index) => (
                        <div
                          key={agent.key}
                          className={`map-node role-${agent.role}`}
                          style={mapPosition(index, snapshot.agents.length)}
                        >
                          <span>{agent.icon}</span>
                          <small>{agent.name.split(' ')[0]}</small>
                        </div>
                      ))}
                    </div>
                    <div className="swarm-legend">
                      <LegendDot color="var(--purple)" label="Orchestrator" />
                      <LegendDot color="var(--teal)" label="Data" />
                      <LegendDot color="var(--amber)" label="Compute" />
                      <LegendDot color="var(--blue)" label="Executor" />
                      <LegendDot color="var(--coral)" label="Vendor" />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'negotiate' && (
            <section className="panel active">
              <div className="main-header">
                <div className="main-title">Negotiation Engine</div>
                <div className="main-subtitle">AI-assisted vendor ranking, approval controls, and Ethereum settlement</div>
              </div>
              <div className="panel-body">
                {latestTask ? (
                  <>
                    <div className="negotiation-card">
                      <div className="neg-header">
                        <div>
                          <div className="neg-title">{latestTask.title}</div>
                          <div className="neg-meta">
                            {latestTask.objective} · Started {timeLabel(latestTask.createdAt)} · Autonomy {latestTask.autonomyLevel}
                          </div>
                        </div>
                        <div className={`section-badge ${statusBadgeClass(latestTask.status)}`}>{latestTask.status.replaceAll('_', ' ')}</div>
                      </div>

                      <div className="two-col-grid">
                        <div className="table-card compact">
                          <div className="rp-title">Mission Plan</div>
                          <div className="trace-note">{latestTask.missionPlan?.summary ?? 'Awaiting orchestrator output.'}</div>
                          {latestTask.missionPlan?.checkpoints?.length ? (
                            <div className="service-stack">
                              {latestTask.missionPlan.checkpoints.map((checkpoint) => (
                                <div key={checkpoint} className="service-meta">• {checkpoint}</div>
                              ))}
                            </div>
                          ) : null}
                          {latestTask.missionPlan?.approvalPolicy && (
                            <div className="trace-note">{latestTask.missionPlan.approvalPolicy}</div>
                          )}
                        </div>

                        <div className="table-card compact">
                          <div className="rp-title">Risk + Receipt Bundle</div>
                          {latestTask.riskAssessment ? (
                            <>
                              <div className="service-row">
                                <div>
                                  <div className="service-name">
                                    {latestTask.riskAssessment.label.toUpperCase()} RISK · {latestTask.riskAssessment.score.toFixed(2)}
                                  </div>
                                  <div className="service-meta">
                                    {latestTask.riskAssessment.provider}
                                    {latestTask.riskAssessment.deploymentId ? ` · deployment ${latestTask.riskAssessment.deploymentId}` : ''}
                                  </div>
                                </div>
                                <div className={`section-badge ${riskBadgeClass(latestTask.riskAssessment.label)}`}>
                                  {latestTask.riskAssessment.requiresApproval ? 'APPROVAL REQUIRED' : 'AUTO-SETTLE OK'}
                                </div>
                              </div>
                              <div className="trace-note">{latestTask.riskAssessment.rationale}</div>
                              {latestTask.riskAssessment.evaluatedAt && (
                                <div className="service-meta">Evaluated {relativeIso(latestTask.riskAssessment.evaluatedAt)}</div>
                              )}
                            </>
                          ) : (
                            <div className="compact-empty">Risk scoring has not completed yet.</div>
                          )}
                          <div className="manifest-links">
                            {latestTask.requirementsArtifact && (
                              <a className="link-inline" href={latestTask.requirementsArtifact.gatewayUrl} target="_blank" rel="noreferrer">
                                Requirements CID
                              </a>
                            )}
                            {latestTask.resultArtifact && (
                              <a className="link-inline" href={latestTask.resultArtifact.gatewayUrl} target="_blank" rel="noreferrer">
                                Result CID
                              </a>
                            )}
                            {latestTask.memoryArtifact && (
                              <a className="link-inline" href={latestTask.memoryArtifact.gatewayUrl} target="_blank" rel="noreferrer">
                                Memory CID
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="neg-timeline">
                        <TimelineStep state="done" label="Mission created" detail={latestTask.objective} time={timeLabel(latestTask.createdAt)} />
                        <TimelineStep state={latestTask.vendorBids.length > 0 ? 'done' : 'pending'} label="Vendor discovery complete" detail={`Collected ${latestTask.vendorBids.length} bids from registered agents`} time={latestTask.vendorBids.length > 0 ? timeLabel(latestTask.updatedAt) : '—'} />
                        <TimelineStep state={latestTask.aiReasoning ? 'done' : 'pending'} label="ComputeAgent ranked bids with OpenRouter" detail={latestTask.aiReasoning ?? 'Waiting for compute inference'} time={latestTask.aiReasoning ? timeLabel(latestTask.updatedAt) : '—'} />
                        <TimelineStep state={latestTask.requirementsCID ? 'done' : 'pending'} label="Lit + Filecoin decision bundle created" detail={latestTask.requirementsCID ? `Stored encrypted bundle at ${truncate(latestTask.requirementsCID, 24)}` : 'Waiting for storage'} time={latestTask.requirementsCID ? timeLabel(latestTask.updatedAt) : '—'} />
                        <TimelineStep state={latestTask.status === 'awaiting_approval' ? 'active' : latestTask.settlement ? 'done' : 'pending'} label="Operator approval gate" detail={latestTask.approval?.reason ?? 'No approval required'} time={latestTask.approval ? timeLabel(latestTask.approval.requestedAt) : latestTask.settlement ? timeLabel(latestTask.updatedAt) : '—'} />
                        <TimelineStep state={latestTask.settlement ? 'done' : latestTask.status === 'settling' ? 'active' : 'pending'} label="TaskEscrow settlement" detail={latestTask.settlement ? `Escrow task #${latestTask.settlement.taskId} completed onchain` : 'Awaiting Ethereum settlement'} time={latestTask.settlement ? timeLabel(latestTask.updatedAt) : '—'} />
                      </div>

                      <div className="price-comparison">
                        <div className="price-box old">
                          <div className="price-label">Budget</div>
                          <div className="price-value">{formatEth(latestTask.baselinePriceWei)} ETH</div>
                        </div>
                        <div className="price-box new">
                          <div className="price-label">Negotiated</div>
                          <div className="price-value">{formatEth(latestTask.finalPriceWei ?? '0')} ETH</div>
                        </div>
                        <div className="price-saving">
                          <div className="saving-label">Saved</div>
                          <div className="saving-amount">{formatEth(latestTask.savingsWei ?? '0')} ETH</div>
                          <div className="saving-label">vs budget</div>
                        </div>
                      </div>

                      <div className="manifest-links">
                        {latestTask.requirementsArtifact && (
                          <a className="link-inline" href={artifactLookupUrl(latestTask.requirementsArtifact.cid)} target="_blank" rel="noreferrer">
                            Requirements metadata
                          </a>
                        )}
                        {latestTask.resultArtifact && (
                          <a className="link-inline" href={artifactLookupUrl(latestTask.resultArtifact.cid)} target="_blank" rel="noreferrer">
                            Result metadata
                          </a>
                        )}
                        {latestTask.memoryArtifact && (
                          <a className="link-inline" href={artifactLookupUrl(latestTask.memoryArtifact.cid)} target="_blank" rel="noreferrer">
                            Memory metadata
                          </a>
                        )}
                      </div>

                      {latestTask.status === 'awaiting_approval' && (
                        <button type="button" className="approve-btn" disabled={approvalLoading} onClick={approveLatestTask}>
                          {approvalLoading ? 'APPROVING…' : `✓ APPROVE — SETTLE ${formatEth(latestTask.finalPriceWei ?? latestTask.budgetWei)} ETH`}
                        </button>
                      )}
                    </div>

                    <div className="section-header">
                      <div className="section-title">Vendor Scorecard</div>
                    </div>
                    <div className="table-card">
                      <table className="registry-table">
                        <thead>
                          <tr>
                            <th>Agent</th>
                            <th>ERC-8004 ID</th>
                            <th>Reputation</th>
                            <th>Initial</th>
                            <th>Floor</th>
                            <th>Score</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestTask.vendorBids.map((bid) => {
                            const winner = bid.agentKey === latestTask.winnerAgentKey;
                            return (
                              <tr key={bid.agentKey} className={winner ? 'highlight-row' : ''}>
                                <td>{bid.agentName}</td>
                                <td>#{String(bid.agentId ?? 0).padStart(3, '0')}</td>
                                <td>{bid.reputationScore}</td>
                                <td>{formatEth(bid.initialPriceWei)} ETH</td>
                                <td>{formatEth(bid.floorPriceWei)} ETH</td>
                                <td>{bid.score ? bid.score.toFixed(2) : '—'}</td>
                                <td>{winner ? 'SELECTED' : 'RANKED'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="empty-card">Launch a mission to populate the negotiation engine.</div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'registry' && (
            <section className="panel active">
              <div className="main-header">
                <div className="main-title">ERC-8004 Agent Registry</div>
                <div className="main-subtitle">Tokenized agent identities linked to operator wallets</div>
              </div>
              <div className="panel-body">
                <div className="table-card">
                  <table className="registry-table">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Agent ID</th>
                        <th>Owner</th>
                        <th>Operator Wallet</th>
                        <th>Capabilities</th>
                        <th>Rep</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.agents.map((agent) => (
                        <tr key={agent.key}>
                          <td>{agent.name}</td>
                          <td>{agent.onchain ? `#${String(agent.onchain.agentId).padStart(3, '0')}` : 'Pending'}</td>
                          <td>{shortAddress(agent.onchain?.owner)}</td>
                          <td>{shortAddress(agent.onchain?.operatorWallet ?? agent.address)}</td>
                          <td>
                            <div className="capability-wrap">
                              {agent.capabilities.map((capability) => (
                                <span key={capability} className="capability-chip">{capability}</span>
                              ))}
                            </div>
                          </td>
                          <td>{agent.reputationScore}</td>
                          <td>{agent.status.replaceAll('_', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'audit' && (
            <section className="panel active">
              <div className="main-header">
                <div className="main-title">Audit Trail</div>
                <div className="main-subtitle">Lit-encrypted Filecoin artifacts anchored through AuditLogger</div>
              </div>
              <div className="panel-body">
                {snapshot.audit.length > 0 ? (
                  <div className="audit-list">
                    {snapshot.audit.map((entry) => (
                      <div key={entry.id} className="audit-entry">
                        <div className="audit-icon">{agentIcon(entry.agentId)}</div>
                        <div className="audit-content">
                          <div className="audit-action">{entry.agentName} · {entry.action}</div>
                          <div className="audit-detail">input {truncate(entry.inputHash, 20)} · output {truncate(entry.outputHash, 20)}</div>
                          <div className="audit-cid">ipfs://{truncate(entry.ipfsCID, 42)}</div>
                          <div className="manifest-links">
                            <a className="link-inline" href={artifactLookupUrl(entry.ipfsCID)} target="_blank" rel="noreferrer">
                              Artifact metadata
                            </a>
                            {entry.txHash && (
                              <a className="link-inline" href={explorerLink(entry.txHash)} target="_blank" rel="noreferrer">
                                Explorer tx
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="audit-time">{relativeIso(entry.timestamp)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-card">No audit receipts have been anchored yet.</div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'payments' && (
            <section className="panel active">
              <div className="main-header">
                <div className="main-title">Settlement Rails</div>
                <div className="main-subtitle">Ethereum-native escrow flow through TaskEscrow</div>
              </div>
              <div className="panel-body">
                <div className="metrics-grid metrics-grid-3">
                  <MetricCard label="Total Settled" value={`${formatEth(snapshot.metrics.totalSettledWei)} ETH`} delta="Confirmed onchain" tone="teal" />
                  <MetricCard label="Awaiting Approval" value={String(snapshot.metrics.tasksAwaitingApproval)} delta="Approval-gated missions" tone="amber" />
                  <MetricCard label="Total Saved" value={`${formatEth(snapshot.metrics.totalSavingsWei)} ETH`} delta="Vs baseline budgets" tone="green" />
                </div>

                <div className="payment-flow">
                  {snapshot.payments.length === 0 && <div className="empty-card">No settlements recorded yet.</div>}
                  {snapshot.payments.map((payment) => (
                    <div key={payment.id} className="payment-step">
                      <div className="pay-icon">Ξ</div>
                      <div className="pay-info">
                        <div className="pay-title">{payment.taskId ?? 'Mesh settlement'}</div>
                        <div className="pay-sub">{shortAddress(payment.from)} → {shortAddress(payment.to)}</div>
                        {payment.txHash && (
                          <div className="manifest-links">
                            <a className="link-inline" href={explorerLink(payment.txHash)} target="_blank" rel="noreferrer">
                              View on Etherscan
                            </a>
                          </div>
                        )}
                      </div>
                      <div className="pay-amount">{payment.amount} ETH</div>
                      <div className={`pay-status ${payment.status}`}>{payment.status.toUpperCase()}</div>
                    </div>
                  ))}
                </div>

                {latestTask?.settlement && (
                  <div className="table-card compact">
                    <div className="rp-title">Current Escrow Trace</div>
                    <div className="trace-grid">
                      <TraceRow label="Escrow Task" value={`#${latestTask.settlement.taskId}`} />
                      <TraceRow label="Create Tx" value={truncate(latestTask.settlement.createTxHash, 18)} href={explorerLink(latestTask.settlement.createTxHash)} />
                      <TraceRow label="Fund Tx" value={truncate(latestTask.settlement.fundTxHash, 18)} href={explorerLink(latestTask.settlement.fundTxHash)} />
                      <TraceRow label="Accept Tx" value={truncate(latestTask.settlement.acceptTxHash, 18)} href={explorerLink(latestTask.settlement.acceptTxHash)} />
                      <TraceRow label="Complete Tx" value={truncate(latestTask.settlement.completeTxHash, 18)} href={explorerLink(latestTask.settlement.completeTxHash)} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'memory' && (
            <section className="panel active">
              <div className="main-header">
                <div className="main-title">Portable Agent Memory</div>
                <div className="main-subtitle">Encrypted state snapshots persisted to Filecoin</div>
              </div>
              <div className="panel-body">
                {snapshot.memory[0] ? (
                  <>
                    <div className="memory-card">
                      <div className="memory-header">
                        <div className="memory-icon">🧠</div>
                        <div>
                          <div className="memory-title">Latest Memory Snapshot</div>
                          <div className="memory-sub">CID: {snapshot.memory[0].cid} · {timeLabel(snapshot.memory[0].timestamp)}</div>
                        </div>
                        <div className="memory-badges">
                          <span className="section-badge badge-complete">LIT</span>
                          <span className="section-badge badge-active">FILECOIN</span>
                        </div>
                      </div>
                      <div className="memory-code">
                        {JSON.stringify(
                          {
                            version: snapshot.memory[0].version,
                            cid: snapshot.memory[0].cid,
                            summary: snapshot.memory[0].summary,
                            latestTask: latestTask?.id ?? null,
                            autonomyLevel: snapshot.autonomyLevel,
                          },
                          null,
                          2
                        )}
                      </div>
                    </div>

                    <div className="table-card">
                      <table className="registry-table">
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>CID</th>
                            <th>Summary</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.memory.map((entry) => (
                            <tr key={entry.version}>
                              <td>v{entry.version}</td>
                              <td>{truncate(entry.cid, 24)}</td>
                              <td>{entry.summary}</td>
                              <td>{timeLabel(entry.timestamp)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="empty-card">No memory snapshots have been written yet.</div>
                )}
              </div>
            </section>
          )}
        </main>

        <aside className="rightpanel">
          {selectedAgent && (
            <>
              <div className="agent-detail">
                <div className="agent-detail-header">
                  <div className="agent-detail-avatar">{selectedAgent.icon}</div>
                  <div>
                    <div className="agent-detail-name">{selectedAgent.name}</div>
                    <div className="agent-detail-id">
                      {selectedAgent.onchain ? `ERC-8004 #${String(selectedAgent.onchain.agentId).padStart(3, '0')}` : 'Pending identity'} · {shortAddress(selectedAgent.address)}
                    </div>
                  </div>
                </div>

                <div className="detail-section">
                  <div className="detail-section-title">Reputation</div>
                  <div className="stat-row"><span>Score</span><span>{selectedAgent.reputationScore} / 100</span></div>
                  <div className="rep-bar"><div className="rep-fill" style={{ width: `${selectedAgent.reputationScore}%` }} /></div>
                  <div className="stat-row"><span>Tasks</span><span>{selectedAgent.taskCount}</span></div>
                  <div className="stat-row"><span>Success</span><span>{Math.round(selectedAgent.successRate * 100)}%</span></div>
                </div>

                <div className="detail-section">
                  <div className="detail-section-title">Capabilities</div>
                  <div className="capability-wrap">
                    {selectedAgent.capabilities.map((capability) => (
                      <span key={capability} className="capability-chip">{capability}</span>
                    ))}
                  </div>
                </div>

                <div className="detail-section">
                  <div className="detail-section-title">Current State</div>
                  <div className="stat-row"><span>Status</span><span>{selectedAgent.status.replaceAll('_', ' ')}</span></div>
                  <div className="stat-row"><span>Intent</span><span className="align-right">{selectedAgent.intent}</span></div>
                  <div className="stat-row"><span>Wallet</span><span>{shortAddress(selectedAgent.onchain?.operatorWallet ?? selectedAgent.address)}</span></div>
                  <div className="stat-row"><span>Storage</span><span>{snapshot.network.storageProvider}</span></div>
                  <div className="stat-row"><span>Approval</span><span>{snapshot.manifest.operatorModel.approvalRequiredAbove} ETH</span></div>
                </div>

                <div className="detail-section">
                  <div className="detail-section-title">Pricing</div>
                  <div className="stat-row"><span>Price / action</span><span>{selectedAgent.pricing ? `${selectedAgent.pricing.displayAmount} ETH` : 'N/A'}</span></div>
                  <div className="stat-row"><span>Chain</span><span>{snapshot.network.label}</span></div>
                </div>
              </div>

              <div className="panel-divider" />

              <div className="rp-section">
                <div className="rp-title">Autonomy Control</div>
                <div className="autonomy-levels">
                  {AUTONOMY_OPTIONS.map((option) => (
                    <button
                      key={option.level}
                      type="button"
                      className={`autonomy-level ${snapshot.autonomyLevel === option.level ? 'selected' : ''}`}
                      onClick={() => updateAutonomy(option.level)}
                    >
                      <div className="autonomy-radio" />
                      <div className="autonomy-text">
                        <div className="autonomy-name">{option.name}</div>
                        <div className="autonomy-desc">{option.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: 'purple' | 'teal' | 'amber' | 'green';
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-delta">{delta}</div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="acf-stat">
      <div className="acf-stat-val">{value}</div>
      <div className="acf-stat-key">{label}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="legend-item">
      <span className="legend-dot" style={{ background: color }} />
      {label}
    </div>
  );
}

function TimelineStep({
  state,
  label,
  detail,
  time,
}: {
  state: 'done' | 'active' | 'pending';
  label: string;
  detail: string;
  time: string;
}) {
  return (
    <div className={`neg-step ${state}`}>
      <div className="neg-step-content">
        <div className="neg-step-label">{label}</div>
        <div className="neg-step-detail">{detail}</div>
      </div>
      <div className="neg-step-time">{time}</div>
    </div>
  );
}

function TraceRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      {href ? (
        <a className="link-inline" href={href} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function formatEth(wei: string) {
  try {
    const value = Number(wei) / 1e18;
    return value.toFixed(value >= 0.01 ? 4 : 6);
  } catch {
    return '0.0000';
  }
}

function shortAddress(address?: string) {
  if (!address) return '—';
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

function relativeIso(value: string) {
  return timeLabel(new Date(value).getTime());
}

function timeLabel(timestamp: number) {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function statusClass(status: Agent['status']) {
  if (status === 'thinking') return 'thinking';
  if (status === 'awaiting_approval') return 'waiting';
  if (status === 'waiting_payment') return 'waiting';
  if (status === 'halted') return 'halted';
  return 'running';
}

function statusDot(status: Agent['status']) {
  if (status === 'thinking') return 'sd-amber';
  if (status === 'awaiting_approval' || status === 'waiting_payment') return 'sd-blue';
  if (status === 'halted') return 'sd-red';
  return 'sd-green';
}

function statusBadgeClass(status: MeshTask['status']) {
  if (status === 'completed') return 'badge-complete';
  if (status === 'awaiting_approval') return 'badge-pending';
  return 'badge-active';
}

function riskBadgeClass(label: 'low' | 'medium' | 'high') {
  if (label === 'high') return 'badge-pending';
  if (label === 'medium') return 'badge-active';
  return 'badge-complete';
}

function tagClass(agentId: string) {
  if (agentId.includes('orchestrator')) return 'orch';
  if (agentId.includes('data')) return 'data';
  if (agentId.includes('compute')) return 'compute';
  if (agentId.includes('executor')) return 'executor';
  return 'vendor';
}

function agentIcon(agentId: string) {
  if (agentId.includes('orchestrator')) return '◈';
  if (agentId.includes('data')) return '◎';
  if (agentId.includes('compute')) return '∆';
  if (agentId.includes('executor')) return '✦';
  return '▣';
}

function humanizeServiceName(value: string) {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function explorerLink(value?: string, kind: 'tx' | 'address' = 'tx') {
  if (!value) return '#';
  const prefix = kind === 'tx' ? 'tx' : 'address';
  return `https://sepolia.etherscan.io/${prefix}/${value}`;
}

function artifactLookupUrl(cid: string) {
  return `${API_URL.replace(/\/$/, '')}/artifacts/${cid}`;
}

function shortUrl(value?: string) {
  if (!value) return '—';
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return value;
  }
}

function mapPosition(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1);
  const radius = 34;
  const x = 50 + Math.cos(angle) * radius;
  const y = 50 + Math.sin(angle) * radius;
  return {
    left: `${x}%`,
    top: `${y}%`,
  };
}
