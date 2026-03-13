import React from 'react';
import type { AgentState } from '../types';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  thinking: 'bg-yellow-500 animate-pulse',
  halted: 'bg-red-500',
  waiting_payment: 'bg-blue-500 animate-pulse',
  idle: 'bg-gray-400',
  offline: 'bg-gray-600',
};

const AGENT_EMOJIS: Record<string, string> = {
  OrchestratorAgent: '🧠',
  DataAgent: '📊',
  ComputeAgent: '⚡',
  ExecutorAgent: '🔐',
  VendorAgent: '🏪',
};

interface AgentCardProps {
  agent: AgentState;
  onInspect?: (agentId: string) => void;
}

export function AgentCard({ agent, onInspect }: AgentCardProps) {
  const emoji = AGENT_EMOJIS[agent.agentName] ?? '🤖';
  const statusColor = STATUS_COLORS[agent.status] ?? 'bg-gray-400';
  const successPercent = agent.successRate ? (agent.successRate * 100).toFixed(0) : 'N/A';

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-500 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            <h3 className="text-white font-semibold text-sm">{agent.agentName}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              <span className="text-gray-400 text-xs capitalize">{agent.status}</span>
            </div>
          </div>
        </div>
        {agent.reputationScore !== undefined && (
          <div className="text-right">
            <div className="text-xs text-gray-400">Rep</div>
            <div className="text-white font-bold text-sm">{agent.reputationScore}</div>
          </div>
        )}
      </div>

      {agent.intent && (
        <div className="bg-gray-700/50 rounded p-2 mb-3">
          <p className="text-gray-300 text-xs leading-relaxed line-clamp-2">{agent.intent}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mb-3">
        {agent.taskCount !== undefined && (
          <div>
            <span className="text-gray-500">Tasks:</span>{' '}
            <span className="text-gray-200">{agent.taskCount}</span>
          </div>
        )}
        {agent.successRate !== undefined && (
          <div>
            <span className="text-gray-500">Success:</span>{' '}
            <span className="text-green-400">{successPercent}%</span>
          </div>
        )}
      </div>

      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {agent.capabilities.slice(0, 2).map((cap) => (
            <span
              key={cap}
              className="bg-gray-700 text-gray-300 text-xs px-1.5 py-0.5 rounded"
            >
              {cap.replace(/_/g, ' ')}
            </span>
          ))}
          {agent.capabilities.length > 2 && (
            <span className="text-gray-500 text-xs">+{agent.capabilities.length - 2}</span>
          )}
        </div>
      )}

      <button
        onClick={() => onInspect?.(agent.agentId)}
        className="w-full text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 rounded py-1 transition-colors"
      >
        Inspect
      </button>
    </div>
  );
}
