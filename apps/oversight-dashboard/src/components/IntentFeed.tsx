import React, { useRef, useEffect } from 'react';
import { useAgentStore } from '../store/agentStore';
import type { IntentEntry } from '../types';

const AGENT_COLORS: Record<string, string> = {
  OrchestratorAgent: 'text-purple-400',
  DataAgent: 'text-teal-400',
  ComputeAgent: 'text-teal-400',
  ExecutorAgent: 'text-teal-400',
  VendorAgent: 'text-orange-400',
};

const ACTION_COLORS: Record<string, string> = {
  AWAITING_APPROVAL: 'text-amber-400 font-semibold',
  HALTED: 'text-red-400 font-semibold',
  ERROR: 'text-red-400',
  COMPLETED: 'text-green-400',
  EXECUTING: 'text-blue-400',
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function IntentItem({ intent }: { intent: IntentEntry }) {
  const agentColor = AGENT_COLORS[intent.agentName] ?? 'text-gray-400';
  const actionColor = ACTION_COLORS[intent.action] ?? 'text-gray-300';

  return (
    <div className="flex gap-2 py-1.5 border-b border-gray-800 last:border-0 text-xs">
      <span className="text-gray-600 shrink-0 font-mono">{formatTime(intent.timestamp)}</span>
      <span className={`shrink-0 font-semibold ${agentColor}`}>
        [{intent.agentName.replace('Agent', '')}]
      </span>
      <span className={`shrink-0 ${actionColor}`}>{intent.action}:</span>
      <span className="text-gray-300 leading-relaxed">{intent.description}</span>
    </div>
  );
}

export function IntentFeed() {
  const { intents, wsConnected } = useAgentStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [intents.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold">Intent Feed</h2>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-xs text-gray-400">
            {wsConnected ? 'Live' : 'Reconnecting...'}
          </span>
          <span className="text-xs text-gray-600">{intents.length} events</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-0 bg-gray-900 rounded-lg p-3 font-mono"
        style={{ maxHeight: '400px' }}
      >
        {intents.length === 0 ? (
          <div className="text-gray-600 text-xs text-center py-8">
            Waiting for agent activity...
          </div>
        ) : (
          intents.map((intent) => <IntentItem key={intent.id} intent={intent} />)
        )}
      </div>

      <div className="mt-2 flex gap-3 text-xs text-gray-600">
        <span className="text-purple-400">■</span> Orchestrator
        <span className="text-teal-400">■</span> Specialists
        <span className="text-orange-400">■</span> Vendor
        <span className="text-amber-400">■</span> Human action
      </div>
    </div>
  );
}
