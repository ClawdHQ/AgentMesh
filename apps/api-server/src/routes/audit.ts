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

const auditLog: AuditEntry[] = [];

export function auditRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { agentId, action, from, to } = req.query;

    let entries = [...auditLog];

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
    const entries = auditLog.filter((e) => e.agentId === req.params.agentId);
    return res.json(entries);
  });

  router.post('/', (req, res) => {
    const entry: AuditEntry = {
      id: String(auditLog.length + 1),
      ...req.body,
      timestamp: isoNow(),
    };
    auditLog.push(entry);
    return res.status(201).json(entry);
  });

  return router;
}
