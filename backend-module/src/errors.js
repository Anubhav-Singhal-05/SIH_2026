import { createHash } from 'node:crypto';

/** Stable error codes per backend_team_spec.md §8. */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_REQUEST: 'INVALID_REQUEST',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  STALE_ROOT: 'STALE_ROOT',
  PERMIT_EXPIRED: 'PERMIT_EXPIRED',
  WRONG_NETWORK: 'WRONG_NETWORK',
  CHAIN_UNAVAILABLE: 'CHAIN_UNAVAILABLE',
  CONTRACT_REVERTED: 'CONTRACT_REVERTED',
  STORAGE_FINALIZATION_FAILED: 'STORAGE_FINALIZATION_FAILED',
  DOCUMENT_NOT_READY: 'DOCUMENT_NOT_READY',
  REORG_IN_PROGRESS: 'REORG_IN_PROGRESS',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

const HTTP_STATUS = {
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.INVALID_REQUEST]: 400,
  [ErrorCode.IDEMPOTENCY_CONFLICT]: 409,
  [ErrorCode.STALE_ROOT]: 409,
  [ErrorCode.PERMIT_EXPIRED]: 410,
  [ErrorCode.WRONG_NETWORK]: 400,
  [ErrorCode.CHAIN_UNAVAILABLE]: 503,
  [ErrorCode.CONTRACT_REVERTED]: 409,
  [ErrorCode.STORAGE_FINALIZATION_FAILED]: 422,
  [ErrorCode.DOCUMENT_NOT_READY]: 404,
  [ErrorCode.REORG_IN_PROGRESS]: 503,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

/** Domain error carrying a stable code; never leaks internals (BE-DOD-004). */
export class DomainError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  get status() {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * Contract custom error -> domain error mapping.
 * Selector names must match src/Errors.sol in blockchain-module (BE-CHAIN-006).
 */
export const CONTRACT_ERROR_MAP = {
  InvalidPermit: ErrorCode.CONTRACT_REVERTED,
  CallerNotController: ErrorCode.CONTRACT_REVERTED,
  IdentityExists: ErrorCode.CONTRACT_REVERTED,
  UnknownIdentity: ErrorCode.DOCUMENT_NOT_READY,
  IdentityNotActive: ErrorCode.FORBIDDEN,
  InvalidController: ErrorCode.INVALID_REQUEST,
  InvalidStatusTransition: ErrorCode.INVALID_REQUEST,
  RootNotInitialized: ErrorCode.CONTRACT_REVERTED,
  RootAlreadyInitialized: ErrorCode.CONTRACT_REVERTED,
  RootVersionMismatch: ErrorCode.STALE_ROOT,
  RootMismatch: ErrorCode.STALE_ROOT,
  UnauthorizedRootWriter: ErrorCode.INTERNAL_ERROR,
  InvalidRoot: ErrorCode.INVALID_REQUEST,
  UnknownAsset: ErrorCode.DOCUMENT_NOT_READY,
  AssetAlreadyExists: ErrorCode.CONTRACT_REVERTED,
  InvalidAssetId: ErrorCode.INVALID_REQUEST,
  AssetInactive: ErrorCode.FORBIDDEN,
  NotAssetOwner: ErrorCode.FORBIDDEN,
  DestinationNotActive: ErrorCode.FORBIDDEN,
  DocumentHashMismatch: ErrorCode.CONTRACT_REVERTED,
  StaleRoot: ErrorCode.STALE_ROOT,
  InvalidTransfer: ErrorCode.INVALID_REQUEST,
  NotInheritanceExecutor: ErrorCode.FORBIDDEN,
  NotAuthorized: ErrorCode.FORBIDDEN,
  InvalidPermissionMask: ErrorCode.INVALID_REQUEST,
  PermissionExpired: ErrorCode.FORBIDDEN,
  SelfGrantForbidden: ErrorCode.INVALID_REQUEST,
  NomineeCannotActivate: ErrorCode.FORBIDDEN,
  InsufficientAuthoritySignatures: ErrorCode.CONTRACT_REVERTED,
  DuplicateAuthority: ErrorCode.CONTRACT_REVERTED,
  InvalidBeneficiary: ErrorCode.INVALID_REQUEST,
  InheritanceNotActive: ErrorCode.CONTRACT_REVERTED,
  BatchTooLarge: ErrorCode.INVALID_REQUEST,
  NoRuleSet: ErrorCode.DOCUMENT_NOT_READY,
  ArrayLengthMismatch: ErrorCode.INVALID_REQUEST,
  AuthoritySignatureExpired: ErrorCode.PERMIT_EXPIRED,
};

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
