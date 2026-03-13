import { Router } from 'express';
import { isoNow } from '@agentmesh/shared';

interface AuditEntry {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  inputHash: string;
  outputHash: string;
  ipfsCID: string;
  timestamp: string;
  txHash?: string;
}

// Mock audit log (in production, fetch from AuditLogger.sol contract events)
const mockAuditLog: AuditEntry[] = [
  {
    id: '1',
    agentId: 'orchestrator-1',
    agentName: 'OrchestratorAgent',
    action: 'task_decomposition',
    inputHash: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890',
    outputHash: 'b2c3d4e5f6789012345678901234567890123456789012345678901234567890a1',
    ipfsCID: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    timestamp: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: '2',
    agentId: 'compute-agent-1',
    agentName: 'ComputeAgent',
    action: 'pricing_analysis',
    inputHash: 'c3d4e5f6789012345678901234567890123456789012345678901234567890a1b2',
    outputHash: 'd4e5f6789012345678901234567890123456789012345678901234567890a1b2c3',
    ipfsCID: 'QmSgvgwxZGaBLqkqMfQbhfEWxMkAkFBFzUCRqiDWCVQiGn',
    timestamp: new Date(Date.now() - 180000).toISOString(),
  },
  {
    id: '3',
    agentId: 'executor-agent-1',
    agentName: 'ExecutorAgent',
    action: 'payment_submission',
    inputHash: 'e5f6789012345678901234567890123456789012345678901234567890a1b2c3d4',
    outputHash: 'f6789012345678901234567890123456789012345678901234567890a1b2c3d4e5',
    ipfsCID: 'QmNSUYVKDSvPUnRLKmuxLggpJPKn7DmBVWNRYjkLtx3WLj',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    txHash: '0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
  },
];

export function auditRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    const { agentId, action, from, to } = req.query;

    let entries = [...mockAuditLog];

    if (agentId) {
      entries = entries.filter((e) => e.agentId === agentId);
    }
    if (action) {
      entries = entries.filter((e) => e.action === String(action));
    }
    if (from) {
      const fromDate = new Date(String(from));
      entries = entries.filter((e) => new Date(e.timestamp) >= fromDate);
    }
    if (to) {
      const toDate = new Date(String(to));
      entries = entries.filter((e) => new Date(e.timestamp) <= toDate);
    }

    return res.json(entries);
  });

  router.get('/:agentId', (req, res) => {
    const entries = mockAuditLog.filter((e) => e.agentId === req.params.agentId);
    return res.json(entries);
  });

  router.post('/', (req, res) => {
    const entry: AuditEntry = {
      id: String(mockAuditLog.length + 1),
      ...req.body,
      timestamp: isoNow(),
    };
    mockAuditLog.push(entry);
    return res.status(201).json(entry);
  });

  return router;
}
