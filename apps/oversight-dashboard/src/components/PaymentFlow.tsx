import React from 'react';
import { useAgentStore } from '../store/agentStore';
import {
  Sankey,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface SankeyNodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: { name: string };
}

const COLORS = ['#a855f7', '#14b8a6', '#f97316', '#22c55e'];

function CustomNode({ x, y, width, height, index, payload }: SankeyNodeProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={COLORS[index % COLORS.length]}
      fillOpacity="0.9"
      rx={4}
    />
  );
}

export function PaymentFlow() {
  const { payments, totalSpent, totalSaved } = useAgentStore();

  const sankeyData = {
    nodes: [
      { name: 'Orchestrator' },
      { name: 'Escrow' },
      { name: 'DataAgent' },
      { name: 'ComputeAgent' },
      { name: 'VendorAgent' },
    ],
    links: [
      { source: 0, target: 1, value: 100 },
      { source: 1, target: 2, value: 10 },
      { source: 1, target: 3, value: 50 },
      { source: 1, target: 4, value: 40 },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Payment Flow</h2>
        <span className="text-xs text-gray-500">{payments.length} transactions</span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500 mb-1">Total Spent</div>
          <div className="text-red-400 font-bold">${totalSpent.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500 mb-1">Total Saved</div>
          <div className="text-green-400 font-bold">${totalSaved.toFixed(2)}</div>
        </div>
      </div>

      {/* Sankey diagram */}
      <div className="bg-gray-800 rounded-lg p-3">
        <div className="text-xs text-gray-500 mb-2">Payment flow (USDC)</div>
        <ResponsiveContainer width="100%" height={150}>
          <Sankey
            data={sankeyData}
            node={CustomNode as React.ComponentType<unknown>}
            link={{ stroke: '#4b5563', strokeOpacity: 0.6 }}
            margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
          >
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const p = payload[0] as { payload?: { name?: string; value?: number } };
                return (
                  <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white">
                    {p.payload?.name}: {p.payload?.value} USDC
                  </div>
                );
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>

      {/* Transaction list */}
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {payments.length === 0 ? (
          <div className="text-gray-600 text-xs text-center py-4">No payments yet</div>
        ) : (
          payments.map((payment) => (
            <div
              key={payment.id}
              className="flex items-center justify-between text-xs bg-gray-800 rounded p-2"
            >
              <div>
                <span className="text-gray-400">{payment.from}</span>
                <span className="text-gray-600 mx-1">→</span>
                <span className="text-gray-400">{payment.to}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400 font-mono">
                  {payment.amount} {payment.currency}
                </span>
                {payment.txHash && (
                  <a
                    href={`https://sepolia.basescan.org/tx/${payment.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    ↗
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
