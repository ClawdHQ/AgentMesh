import React from 'react';
import { useAgentStore } from '../store/agentStore';
import { useAuditLog } from '../hooks/useAuditLog';

export function AuditLog() {
  const { auditEntries } = useAgentStore();
  useAuditLog(); // Auto-fetches and updates store

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold">Audit Log</h2>
        <span className="text-xs text-gray-500">{auditEntries.length} entries</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2" style={{ maxHeight: '350px' }}>
        {auditEntries.length === 0 ? (
          <div className="text-gray-600 text-xs text-center py-8">No audit entries yet</div>
        ) : (
          auditEntries.map((entry) => (
            <div
              key={entry.id}
              className="bg-gray-800 border border-gray-700 rounded p-3 text-xs space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-gray-300 font-medium">{entry.agentName}</span>
                <span className="text-gray-500">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-purple-400 font-mono">{entry.action}</div>
              <div className="space-y-0.5">
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">In:</span>
                  <span className="text-gray-400 font-mono truncate">{entry.inputHash.slice(0, 16)}...</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">Out:</span>
                  <span className="text-gray-400 font-mono truncate">{entry.outputHash.slice(0, 16)}...</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">IPFS:</span>
                <a
                  href={`https://ipfs.io/ipfs/${entry.ipfsCID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 font-mono truncate"
                >
                  {entry.ipfsCID.slice(0, 20)}...
                </a>
              </div>
              {entry.txHash && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Tx:</span>
                  <a
                    href={`https://sepolia.basescan.org/tx/${entry.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-400 hover:text-teal-300 font-mono truncate"
                  >
                    {entry.txHash.slice(0, 20)}...
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
