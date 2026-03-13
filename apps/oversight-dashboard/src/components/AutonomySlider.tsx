import React from 'react';
import { useAgentStore } from '../store/agentStore';
import type { AutonomyLevel } from '../types';

const LEVELS: Array<{ level: AutonomyLevel; label: string; description: string; color: string }> = [
  {
    level: 0,
    label: 'Always ask',
    description: 'Request approval for every action',
    color: 'bg-red-500',
  },
  {
    level: 1,
    label: 'Ask for payments',
    description: 'Auto-approve data/compute, ask before payments',
    color: 'bg-orange-500',
  },
  {
    level: 2,
    label: 'Ask >$10',
    description: 'Auto-approve under $10, ask for larger amounts',
    color: 'bg-yellow-500',
  },
  {
    level: 3,
    label: 'Ask >$50',
    description: 'Auto-approve under $50, ask for larger amounts',
    color: 'bg-blue-500',
  },
  {
    level: 4,
    label: 'Fully autonomous',
    description: 'Agents operate without human approval',
    color: 'bg-green-500',
  },
];

export function AutonomySlider() {
  const { autonomyLevel, setAutonomyLevel } = useAgentStore();
  const current = LEVELS[autonomyLevel];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Autonomy Level</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${current.color}`}
        >
          {current.label}
        </span>
      </div>

      <input
        type="range"
        min="0"
        max="4"
        step="1"
        value={autonomyLevel}
        onChange={(e) => setAutonomyLevel(parseInt(e.target.value) as AutonomyLevel)}
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />

      <div className="flex justify-between text-xs text-gray-600">
        <span>Manual</span>
        <span>Auto</span>
      </div>

      <p className="text-gray-400 text-xs bg-gray-800 rounded p-2">{current.description}</p>
    </div>
  );
}
