// AgentMesh shared error types

export class AgentMeshError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'AgentMeshError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AgentMeshError.prototype);
  }
}

export class AgentRegistrationError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'AGENT_REGISTRATION_ERROR', details);
    this.name = 'AgentRegistrationError';
  }
}

export class PaymentError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'PAYMENT_ERROR', details);
    this.name = 'PaymentError';
  }
}

export class NegotiationError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'NEGOTIATION_ERROR', details);
    this.name = 'NegotiationError';
  }
}

export class StorageError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'STORAGE_ERROR', details);
    this.name = 'StorageError';
  }
}

export class NetworkError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export class ProofError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'PROOF_ERROR', details);
    this.name = 'ProofError';
  }
}

export class TaskError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'TASK_ERROR', details);
    this.name = 'TaskError';
  }
}

export class AuthorizationError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', details);
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class HaltError extends AgentMeshError {
  constructor(message: string, details?: unknown) {
    super(message, 'HALT_ERROR', details);
    this.name = 'HaltError';
  }
}
