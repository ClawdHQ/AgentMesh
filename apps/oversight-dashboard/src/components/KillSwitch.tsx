import React, { useState } from 'react';
import { useKillSwitch } from '../hooks/useKillSwitch';

export function KillSwitch() {
  const { haltState, halt, resume } = useKillSwitch();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleHalt = async () => {
    setIsLoading(true);
    await halt('Emergency halt by operator');
    setIsLoading(false);
    setShowConfirm(false);
  };

  const handleResume = async () => {
    setIsLoading(true);
    await resume();
    setIsLoading(false);
  };

  if (haltState.halted) {
    return (
      <div className="space-y-3">
        <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 text-center">
          <div className="text-red-400 font-bold text-lg mb-1">⛔ MESH HALTED</div>
          {haltState.reason && (
            <div className="text-red-300 text-xs">{haltState.reason}</div>
          )}
        </div>
        <button
          onClick={handleResume}
          disabled={isLoading}
          className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <span className="animate-spin">⟳</span>
          ) : (
            <>▶ RESUME MESH</>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showConfirm ? (
        <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 space-y-3">
          <p className="text-red-300 text-sm font-semibold text-center">
            ⚠️ Halt all agents?
          </p>
          <p className="text-gray-400 text-xs text-center">
            All running agents will stop immediately. This cannot be undone without manual resume.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleHalt}
              disabled={isLoading}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2 rounded text-sm transition-colors"
            >
              {isLoading ? '...' : 'HALT ALL'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
          className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-lg transition-colors text-lg shadow-lg shadow-red-900/30"
        >
          🛑 KILL SWITCH
        </button>
      )}
    </div>
  );
}
