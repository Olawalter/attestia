/**
 * Types mirroring the DEPLOYED contract schema (§54.3).
 *
 * These were written against `genlayer schema <address>` output for the
 * live deployment, not against the Python source — the chain is what the
 * app talks to. Every read below returns exactly these fields.
 */

export type ClaimStatus =
  | "DRAFT"
  | "OPEN"
  | "EVIDENCE_CLOSED"
  | "ADJUDICATING"
  | "ADJUDICATED"
  | "CHALLENGED"
  | "RE_ADJUDICATING"
  | "FINALIZED";

/** §20 — never TRUE/FALSE. "" means no verdict yet, not a default. */
export type Verdict =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "CONTRADICTED"
  | "INCONCLUSIVE"
  | "OUTDATED"
  | "";

export type EvidenceStatus = "ACTIVE" | "OUTDATED" | "REMOVED";

export type Relationship =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "PARTIALLY_SUPPORTS"
  | "IRRELEVANT"
  | "OUTDATED"
  | "RELATED"
  | "UNCLASSIFIED"
  | "";

export type Retrieval = "SOURCE_OK" | "SOURCE_UNAVAILABLE" | "SOURCE_INVALID" | "";

export type ChallengeStatus = "OPEN" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";

export interface ProtocolInfo {
  version: string;
  claim_count: number;
  /** Where the protocol reads time from. No caller can set it. */
  clock_source: string;
  clock_tolerance_seconds: number;
  verdicts: string[];
  states: string[];
  evidence_statuses: string[];
  relationships: string[];
  retrieval_outcomes: string[];
  challenge_statuses: string[];
  default_challenge_window_seconds: number;
  default_evidence_window_seconds: number;
  max_evidence_per_version: number;
  max_versions: number;
}

export interface Claim {
  claim_id: string;
  claim_text: string;
  creator: string;
  status: ClaimStatus;
  current_version: number;
  /** Ordering, not time — a sequence cannot be mistaken for a clock. */
  created_seq: number;
  updated_seq: number;
  evidence_window_seconds: number;
  /** Real UTC seconds, observed through consensus. 0 until reached. */
  opened_at: number;
  evidence_deadline: number;
  adjudicated_at: number;
  challenge_deadline: number;
  finalized_at: number;
  evidence_count: number;
  total_evidence_count: number;
  challenge_count: number;
  adjudication_count: number;
  current_verdict: Verdict;
  current_adjudication_id: string;
  current_attestation_id: string;
  evidence_window_open: boolean;
}

export interface ClaimSummary {
  claim_id: string;
  claim_text: string;
  creator: string;
  status: ClaimStatus;
  current_version: number;
  current_verdict: Verdict;
  evidence_count: number;
  challenge_count: number;
  created_seq: number;
  finalized_at: number;
}

export interface ClaimPage {
  total: number;
  offset: number;
  count: number;
  rows: ClaimSummary[];
}

export interface Evidence {
  evidence_id: string;
  claim_id: string;
  submitted_by: string;
  source_url: string;
  source_type: string;
  description: string;
  submitted_seq: number;
  claim_version: number;
  status: EvidenceStatus;
  /** What the submitter asserted. Never authoritative (§15, §39). */
  declared_relationship: Relationship;
  /** What the panel found. Empty until adjudication has ruled. */
  adjudicated_relationship: Relationship;
  adjudicated_in: string;
  retrieval: Retrieval;
  /** sha256 of the canonical text the panel read. "" = nothing was read. */
  content_digest: string;
}

export interface Adjudication {
  adjudication_id: string;
  claim_id: string;
  claim_version: number;
  round_number: number;
  verdict: Verdict;
  reason: string;
  supporting_evidence: string[];
  contradicting_evidence: string[];
  partially_supporting_evidence: string[];
  irrelevant_evidence: string[];
  outdated_evidence: string[];
  unavailable_evidence: string[];
  evidence_snapshot: Array<Record<string, unknown>>;
  evidence_snapshot_hash: string;
  /** What the panel actually read, per source (§14). */
  content_bindings: Array<{ evidence_id: string; retrieval: string; digest: string }>;
  content_binding_hash: string;
  adjudicated_at: number;
}

export interface Challenge {
  challenge_id: string;
  claim_id: string;
  target_version: number;
  resulting_version: number;
  submitted_by: string;
  reason: string;
  counter_evidence_ids: string[];
  submitted_seq: number;
  status: ChallengeStatus;
}

export interface Attestation {
  attestation_id: string;
  claim_id: string;
  claim_text: string;
  claim_version: number;
  verdict: Verdict;
  adjudication_id: string;
  evidence_count: number;
  challenge_count: number;
  claim_created_seq: number;
  adjudicated_at: number;
  finalized_at: number;
  evidence_snapshot_hash: string;
  content_binding_hash: string;
  contract: string;
}

/** §30 — what verify_attestation reports back. */
export interface AttestationCheck {
  attestation_id: string;
  claim_id?: string;
  claim_version?: number;
  verdict: Verdict;
  finalized?: boolean;
  evidence_count?: number;
  challenge_count?: number;
  adjudication_id?: string;
  evidence_snapshot_hash?: string;
  content_binding_hash?: string;
  valid: boolean;
  reason: string;
}

/** §57 — the compact answer an autonomous agent consumes. */
export interface ClaimVerdict {
  claim_id: string;
  version: number;
  verdict: Verdict;
  status: ClaimStatus;
  finalized: boolean;
  evidence_count: number;
  challenge_count: number;
  attestation_id: string;
}

export interface HistoryVersion {
  claim_version: number;
  round_number: number;
  adjudication_id: string;
  verdict: Verdict;
  reason: string;
  adjudicated_at: number;
  evidence_snapshot_hash: string;
  superseded: boolean;
}

export interface ClaimHistory {
  claim_id: string;
  claim_text: string;
  current_version: number;
  status: ClaimStatus;
  current_verdict: Verdict;
  attestation_id: string;
  versions: HistoryVersion[];
  challenges: Challenge[];
}

/**
 * §34 — the phases a write actually passes through.
 *
 * `submitted` means a hash exists and nothing more. It is deliberately
 * distinct from `finalized`, because a transaction can be accepted by the
 * network and still have reverted.
 */
export type TxPhase =
  | "idle"
  | "signing"
  | "submitted"
  | "pending"
  | "finalized"
  | "reverted"
  | "rejected"
  | "failed";

/** §19 — the public tamper check. */
export interface BindingCheck {
  evidence_id: string;
  claim_id: string;
  claim_version: number;
  adjudicated_in: string;
  bound_digest: string;
  supplied_digest: string;
  bound: boolean;
  matches: boolean;
  reason: string;
}
