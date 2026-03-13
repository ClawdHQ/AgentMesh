import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgentStore } from './store/agentStore';
import { useAgentStream } from './hooks/useAgentStream';
import { AgentCard } from './components/AgentCard';
import { IntentFeed } from './components/IntentFeed';
import { KillSwitch } from './components/KillSwitch';
import { AutonomySlider } from './components/AutonomySlider';
import { AuditLog } from './components/AuditLog';
import { PaymentFlow } from './components/PaymentFlow';
import type { AgentState, DemoResult } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function ApprovalModal({
  approval,
  onApprove,
  onDeny,
}: {
  approval: { description: string; amount?: string };
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-amber-500 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl shadow-amber-900/30">
        <div className="text-amber-400 text-lg font-bold mb-2">⚠️ Human Approval Required</div>
        <p className="text-gray-300 mb-4 text-sm leading-relaxed">{approval.description}</p>
        {approval.amount && (
          <div className="bg-gray-700 rounded p-3 mb-4 text-center">
            <span className="text-gray-400 text-xs">Amount: </span>
            <span className="text-white font-bold">{approval.amount}</span>
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onDeny}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg transition-colors text-sm"
          >
            Deny
          </button>
          <button
            onClick={onApprove}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2.5 rounded-lg transition-colors text-sm"
          >
            ✓ Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function DemoResultModal({
  result,
  onClose,
}: {
  result: DemoResult;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-40 overflow-y-auto">
      <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 max-w-lg w-full mx-4 my-8 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">
            {result.success ? '✅' : '❌'} Demo Complete
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <div className="text-gray-400 text-sm mb-3">{result.scenario}</div>

        {result.success && result.savings > 0 && (
          <div className="bg-green-900/30 border border-green-600 rounded-lg p-3 mb-4 text-center">
            <div className="text-green-400 font-bold text-xl">
              ${result.savings.toFixed(2)}/year saved
            </div>
            <div className="text-green-300 text-xs mt-1">
              {result.requiresHumanApproval ? 'Awaiting your approval' : 'Ready to execute'}
            </div>
          </div>
        )}

        {result.auditCID && (
          <div className="bg-gray-700 rounded p-2 mb-4 text-xs">
            <span className="text-gray-400">Audit CID: </span>
            <a
              href={`https://ipfs.io/ipfs/${result.auditCID}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 font-mono"
            >
              {result.auditCID.slice(0, 30)}...
            </a>
          </div>
        )}

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {result.steps.map((step, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-green-400 shrink-0">✓</span>
              <span className="text-gray-300">{step.description}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function App() {
  useAgentStream();

  const {
    agents,
    setAgents,
    haltState,
    pendingApproval,
    setPendingApproval,
    demoRunning,
    demoResult,
    setDemoRunning,
    setDemoResult,
    addIntent,
    addSavings,
  } = useAgentStore();

  const [inspectedAgent, setInspectedAgent] = useState<string | null>(null);

  // Fetch initial agent list
  const { data: agentData } = useQuery<AgentState[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/agents`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      return res.json() as Promise<AgentState[]>;
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });

  useEffect(() => {
    if (agentData) setAgents(agentData);
  }, [agentData, setAgents]);

  const runDemo = async () => {
    setDemoRunning(true);
    setDemoResult(null);

    addIntent({
      id: `demo-start-${Date.now()}`,
      agentId: 'orchestrator-1',
      agentName: 'OrchestratorAgent',
      action: 'DEMO_START',
      description: 'Starting Slack Pro subscription optimization demo',
      timestamp: Date.now(),
      status: 'executing',
    });

    try {
      const res = await fetch(`${API_URL.replace('3001', '3002')}/demo/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const result = await res.json() as DemoResult;
        setDemoResult(result);
        if (result.savings > 0) {
          addSavings(result.savings);
        }
      } else {
        // Simulate demo locally if API not available
        await simulateLocalDemo();
      }
    } catch {
      await simulateLocalDemo();
    } finally {
      setDemoRunning(false);
    }
  };

  const simulateLocalDemo = async () => {
    const steps = [
      { agent: 'DataAgent', action: 'FETCHING', desc: 'DataAgent fetched current Slack Pro price: $12.50/month' },
      { agent: 'OrchestratorAgent', action: 'DISCOVERING', desc: 'Discovered 3 vendor agents with subscription_pricing capability' },
      { agent: 'OrchestratorAgent', action: 'NEGOTIATING', desc: 'Running NegotiationEngine with top 3 vendors (Round 1 of 3)' },
      { agent: 'ComputeAgent', action: 'COMPUTING', desc: 'ComputeAgent analyzing vendor pricing options' },
      { agent: 'OrchestratorAgent', action: 'NEGOTIATING', desc: 'Round 2: BetterComms Pro offers $10.00/month (-20%)' },
      { agent: 'OrchestratorAgent', action: 'NEGOTIATING', desc: 'Round 3: NegotiationEngine settled at $8.50/month with BetterComms Pro' },
      { agent: 'OrchestratorAgent', action: 'AWAITING_APPROVAL', desc: 'Human approval needed: Save $48.00/year by switching to BetterComms Pro?' },
    ];

    for (const step of steps) {
      addIntent({
        id: `demo-${Date.now()}-${Math.random()}`,
        agentId: step.agent.toLowerCase().replace('agent', '-agent-1'),
        agentName: step.agent,
        action: step.action,
        description: step.desc,
        timestamp: Date.now(),
        status: 'executing',
      });
      await new Promise((r) => setTimeout(r, 800));
    }

    setDemoResult({
      success: true,
      scenario: 'Slack Pro subscription optimization',
      steps: steps.map((s) => ({ step: s.action, description: s.desc, timestamp: new Date().toISOString() })),
      savings: 48,
      auditCID: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      requiresHumanApproval: true,
    });
  };

  const handleApprove = () => {
    addIntent({
      id: `approval-${Date.now()}`,
      agentId: 'human',
      agentName: 'Human',
      action: 'APPROVED',
      description: pendingApproval?.description ?? 'Human approved the action',
      timestamp: Date.now(),
      status: 'completed',
    });
    setPendingApproval(null);
  };

  const handleDeny = () => {
    addIntent({
      id: `denial-${Date.now()}`,
      agentId: 'human',
      agentName: 'Human',
      action: 'DENIED',
      description: 'Human denied the requested action',
      timestamp: Date.now(),
      status: 'failed',
    });
    setPendingApproval(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🕸️</div>
            <div>
              <h1 className="text-white font-bold text-lg leading-none">AgentMesh</h1>
              <p className="text-gray-500 text-xs">Oversight Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {haltState.halted && (
              <div className="bg-red-900/50 border border-red-500 px-3 py-1 rounded-full text-red-300 text-xs font-bold animate-pulse">
                ⛔ HALTED
              </div>
            )}

            <button
              onClick={runDemo}
              disabled={demoRunning || haltState.halted}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              {demoRunning ? (
                <>
                  <span className="animate-spin">⟳</span> Running Demo...
                </>
              ) : (
                <>▶ Run Demo</>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout: 3 columns */}
      <div className="max-w-screen-2xl mx-auto p-4 grid grid-cols-12 gap-4">
        {/* Left: Agent list + controls */}
        <div className="col-span-3 space-y-4">
          <div>
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Active Agents ({agents.length})
            </h2>
            <div className="space-y-3">
              {agents.map((agent) => (
                <AgentCard key={agent.agentId} agent={agent} onInspect={setInspectedAgent} />
              ))}
              {agents.length === 0 && (
                <div className="text-gray-600 text-sm text-center py-8 border border-dashed border-gray-800 rounded-lg">
                  No agents connected
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <AutonomySlider />
          </div>

          <div className="border-t border-gray-800 pt-4">
            <KillSwitch />
          </div>
        </div>

        {/* Center: Intent feed + negotiation */}
        <div className="col-span-5 space-y-4">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <IntentFeed />
          </div>

          {/* Demo CTA when no activity */}
          {!demoRunning && (
            <div className="bg-gradient-to-br from-purple-900/30 to-gray-900 border border-purple-700/50 rounded-xl p-4">
              <h3 className="text-purple-300 font-semibold mb-2">🚀 Demo Scenario</h3>
              <p className="text-gray-400 text-sm mb-3">
                Watch AgentMesh optimize your Slack Pro subscription — live negotiation, USDC payments, and cryptographic decision proofs.
              </p>
              <button
                onClick={runDemo}
                disabled={demoRunning || haltState.halted}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                ▶ Start Subscription Demo
              </button>
            </div>
          )}
        </div>

        {/* Right: Audit log + payment flow */}
        <div className="col-span-4 space-y-4">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <AuditLog />
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <PaymentFlow />
          </div>
        </div>
      </div>

      {/* Modals */}
      {pendingApproval && (
        <ApprovalModal
          approval={pendingApproval}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {demoResult && (
        <DemoResultModal
          result={demoResult}
          onClose={() => setDemoResult(null)}
        />
      )}
    </div>
  );
}
