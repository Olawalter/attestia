"use client";

/**
 * §37 — the claim graph.
 *
 * Every node and every edge is derived from contract state. There is no
 * layout data, no relationship, and no node on this canvas that the
 * protocol did not produce — which is why the edge labels are the
 * panel's own classifications rather than a visual guess at what a
 * source "seems to" do (§59).
 *
 * The one subtlety worth stating: evidence that has not been adjudicated
 * yet is drawn with a dashed, unlabelled edge. A solid labelled edge
 * means a validator panel ruled on that source. The graph must not let a
 * submitter's assertion look like a finding any more than the evidence
 * cards do (§15, §39).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow,
  useEdgesState, useNodesState,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  Adjudication, Challenge, Claim, Evidence, Relationship,
} from "@/lib/contracts/types";
import { hostOf } from "@/lib/utils";

// ─── node kinds (§37) ───────────────────────────────────────────────────
type Kind = "claim" | "evidence" | "challenge" | "adjudication"
  | "attestation" | "related";

interface NodeData extends Record<string, unknown> {
  kind: Kind;
  title: string;
  subtitle?: string;
  detail?: string;
  muted?: boolean;
}

const KIND_STYLE: Record<Kind, { border: string; accent: string; label: string }> = {
  claim: { border: "#d4af37", accent: "text-gold", label: "CLAIM" },
  evidence: { border: "#2e2c27", accent: "text-paper-muted", label: "EVIDENCE" },
  challenge: { border: "#5d302b", accent: "text-[#c2695e]", label: "CHALLENGE" },
  adjudication: { border: "#3d4a3b", accent: "text-verdict-supported", label: "ADJUDICATION" },
  attestation: { border: "#d4af37", accent: "text-gold", label: "ATTESTATION" },
  related: { border: "#2e2c27", accent: "text-paper-faint", label: "RELATED CLAIM" },
};

function ProtocolNode({ data }: NodeProps) {
  const node = data as NodeData;
  const style = KIND_STYLE[node.kind];
  return (
    <div
      className={`w-[190px] border bg-ink-raised px-3 py-2.5 ${
        node.muted ? "opacity-55" : ""}`}
      style={{ borderColor: style.border }}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#2e2c27]" />
      <p className={`font-mono text-[9px] tracking-[0.16em] ${style.accent}`}>
        {style.label}
      </p>
      <p className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-paper">
        {node.title}
      </p>
      {node.subtitle && (
        <p className="mt-1 font-mono text-[9px] text-paper-faint">{node.subtitle}</p>
      )}
      {node.detail && (
        <p className="mt-1 font-mono text-[9px] text-paper-muted">{node.detail}</p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-[#2e2c27]" />
    </div>
  );
}

const nodeTypes = { protocol: ProtocolNode };

/** §37 edge vocabulary, mapped from the panel's own relationship values. */
const EDGE_LABEL: Record<Relationship, string> = {
  SUPPORTS: "SUPPORTS",
  CONTRADICTS: "CONTRADICTS",
  PARTIALLY_SUPPORTS: "PARTIALLY_SUPPORTS",
  IRRELEVANT: "IRRELEVANT",
  OUTDATED: "OUTDATED",
  RELATED: "RELATED",
  UNCLASSIFIED: "",
  "": "",
};

const EDGE_COLOR: Record<string, string> = {
  SUPPORTS: "#7fae7a",
  CONTRADICTS: "#c2695e",
  PARTIALLY_SUPPORTS: "#d4af37",
  IRRELEVANT: "#4a4842",
  OUTDATED: "#8a7fae",
  RELATED: "#4a4842",
  CHALLENGES: "#c2695e",
  PRODUCED: "#d4af37",
  SUPERSEDES: "#8a7fae",
};

export interface RelatedCase {
  claim_id: string;
  claim_text: string;
  sharedSource: string;
}

export function ClaimGraph({
  claim, evidence, adjudications, challenges, related,
}: {
  claim: Claim;
  evidence: Evidence[];
  adjudications: Adjudication[];
  challenges: Challenge[];
  related?: RelatedCase[];
}) {
  const [query, setQuery] = useState("");

  const { nodes, edges } = useMemo(() => {
    const nodes: Node<NodeData>[] = [];
    const edges: Edge[] = [];

    // The claim sits at the origin; everything else is placed around it.
    nodes.push({
      id: "claim",
      type: "protocol",
      position: { x: 0, y: 0 },
      data: {
        kind: "claim",
        title: claim.claim_text,
        subtitle: `${claim.claim_id} · v${claim.current_version}`,
        detail: claim.current_verdict || undefined,
      },
    });

    // ── evidence, left column ──
    const current = evidence.filter(
      (e) => e.claim_version === claim.current_version && e.status !== "REMOVED");
    const spacing = 108;
    const top = -((current.length - 1) * spacing) / 2;

    current.forEach((item, index) => {
      const id = `ev-${item.evidence_id}`;
      const ruled = Boolean(item.adjudicated_in);
      nodes.push({
        id,
        type: "protocol",
        position: { x: -420, y: top + index * spacing },
        data: {
          kind: "evidence",
          title: item.description,
          subtitle: `${item.evidence_id} · ${hostOf(item.source_url)}`,
          detail: item.retrieval === "SOURCE_UNAVAILABLE"
            ? "could not be retrieved" : undefined,
        },
      });

      const label = ruled ? EDGE_LABEL[item.adjudicated_relationship] : "";
      edges.push({
        id: `${id}->claim`,
        source: id,
        target: "claim",
        label: label || undefined,
        animated: false,
        // Dashed and unlabelled until a panel has actually ruled: an
        // unadjudicated source has no established relationship to draw.
        style: {
          stroke: ruled ? (EDGE_COLOR[label] ?? "#4a4842") : "#2e2c27",
          strokeWidth: ruled ? 1.4 : 1,
          strokeDasharray: ruled ? undefined : "4 4",
        },
        labelStyle: { fill: EDGE_COLOR[label] ?? "#a4a19a", fontSize: 9,
                      fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: "#080808" },
      });
    });

    // ── adjudications, right column, one per round ──
    adjudications.forEach((adj, index) => {
      const id = `adj-${adj.adjudication_id}`;
      nodes.push({
        id,
        type: "protocol",
        position: { x: 340, y: -60 + index * 150 },
        data: {
          kind: "adjudication",
          title: adj.verdict.replace(/_/g, " "),
          subtitle: `${adj.adjudication_id} · v${adj.claim_version}`,
          detail: `round ${adj.round_number}`,
          muted: adj.claim_version !== claim.current_version,
        },
      });
      edges.push({
        id: `claim->${id}`,
        source: "claim",
        target: id,
        label: "PRODUCED",
        style: { stroke: EDGE_COLOR.PRODUCED, strokeWidth: 1.4 },
        labelStyle: { fill: EDGE_COLOR.PRODUCED, fontSize: 9,
                      fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: "#080808" },
      });

      // §27 — a later round supersedes the one before it, and the graph
      // shows that rather than hiding the earlier verdict.
      const previous = adjudications[index - 1];
      if (previous) {
        edges.push({
          id: `adj-${previous.adjudication_id}->${id}`,
          source: `adj-${previous.adjudication_id}`,
          target: id,
          label: "SUPERSEDES",
          style: { stroke: EDGE_COLOR.SUPERSEDES, strokeWidth: 1.2 },
          labelStyle: { fill: EDGE_COLOR.SUPERSEDES, fontSize: 9,
                        fontFamily: "var(--font-mono)" },
          labelBgStyle: { fill: "#080808" },
        });
      }
    });

    // ── challenges, below ──
    challenges.forEach((ch, index) => {
      const id = `chal-${ch.challenge_id}`;
      nodes.push({
        id,
        type: "protocol",
        position: { x: -60 + index * 230, y: 260 },
        data: {
          kind: "challenge",
          title: ch.reason,
          subtitle: `${ch.challenge_id} · ${ch.status.toLowerCase()}`,
          detail: `v${ch.target_version} → v${ch.resulting_version}`,
        },
      });
      edges.push({
        id: `${id}->claim`,
        source: id,
        target: "claim",
        label: "CHALLENGES",
        style: { stroke: EDGE_COLOR.CHALLENGES, strokeWidth: 1.4 },
        labelStyle: { fill: EDGE_COLOR.CHALLENGES, fontSize: 9,
                      fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: "#080808" },
      });
    });

    // ── attestation, far right ──
    if (claim.current_attestation_id) {
      nodes.push({
        id: "att",
        type: "protocol",
        position: { x: 660, y: 0 },
        data: {
          kind: "attestation",
          title: "Finalized attestation",
          subtitle: claim.current_attestation_id,
          detail: claim.current_verdict || undefined,
        },
      });
      const final = adjudications.find(
        (a) => a.adjudication_id === claim.current_adjudication_id);
      edges.push({
        id: "adj->att",
        source: final ? `adj-${final.adjudication_id}` : "claim",
        target: "att",
        label: "PRODUCED",
        style: { stroke: EDGE_COLOR.PRODUCED, strokeWidth: 1.4 },
        labelStyle: { fill: EDGE_COLOR.PRODUCED, fontSize: 9,
                      fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: "#080808" },
      });
    }

    // ── related cases (§18) ──
    // Only ever rendered from a real shared source. Relatedness here means
    // "these two cases rest on the same document", which is a fact about
    // the record — not a claim that they share a truth.
    (related ?? []).forEach((item, index) => {
      const id = `rel-${item.claim_id}`;
      nodes.push({
        id,
        type: "protocol",
        position: { x: -420, y: 320 + index * 108 },
        data: {
          kind: "related",
          title: item.claim_text,
          subtitle: item.claim_id,
          detail: `shares ${hostOf(item.sharedSource)}`,
        },
      });
      edges.push({
        id: `${id}->claim`,
        source: id,
        target: "claim",
        label: "RELATED",
        style: { stroke: EDGE_COLOR.RELATED, strokeWidth: 1,
                 strokeDasharray: "2 3" },
        labelStyle: { fill: "#6f6c66", fontSize: 9,
                      fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: "#080808" },
      });
    });

    return { nodes, edges };
  }, [claim, evidence, adjudications, challenges, related]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /**
   * React Flow measures each node with a ResizeObserver after mount and
   * writes the dimensions back through `onNodesChange`. Edges cannot
   * compute their endpoints until those measurements land, which has two
   * consequences worth knowing.
   *
   * First, node state must not be rebuilt from scratch on every render.
   * The parent passes `evidence ?? []` and friends — new array
   * identities each time — so reacting to identity would replace the
   * nodes constantly and throw away the measurements React Flow had just
   * recorded. Hence the content signature below, and the merge that
   * carries each node's measured state forward.
   *
   * Second, and worth writing down because it cost an afternoon: those
   * measurements only happen while the document is actually painting.
   * Querying the DOM for `.react-flow__edge-path` from an automated
   * browser whose pane is not rendering returns zero edges even though
   * the graph is completely healthy — the nodes are there, `fitView` has
   * run, the ids all match, and the edges simply have not been created
   * yet. Verify this graph with a screenshot, not a DOM count.
   */
  const signature = useMemo(
    () => JSON.stringify({
      n: nodes.map((n) => [n.id, n.data.title, n.data.subtitle, n.data.detail]),
      e: edges.map((e) => [e.id, e.label ?? ""]),
      q: query.trim().toLowerCase(),
    }),
    [nodes, edges, query],
  );

  useEffect(() => {
    const needle = query.trim().toLowerCase();
    const next = needle
      ? nodes.map((node) => {
          const hit = [node.data.title, node.data.subtitle, node.data.detail]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle));
          return { ...node, data: { ...node.data, muted: !hit } };
        })
      : nodes;

    setRfNodes((prev) => {
      const measured = new Map(prev.map((node) => [node.id, node]));
      return next.map((node) => {
        const existing = measured.get(node.id);
        // Keep whatever React Flow already learned about this node.
        return existing ? { ...existing, data: node.data } : node;
      });
    });
    setRfEdges(edges);
    // `signature` stands in for the content of nodes/edges/query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, setRfNodes, setRfEdges]);

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the graph — evidence, verdicts, ids"
        className="w-full border border-rule bg-ink-sunken px-3 py-2 font-mono
                   text-xs text-paper outline-none placeholder:text-paper-faint
                   focus:border-gold"
      />

      <div className="h-[520px] border border-rule bg-ink">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.2}
          maxZoom={1.6}
          nodesConnectable={false}
          edgesFocusable={false}
        >
          <Background color="#201f1c" gap={22} size={1} />
          <Controls className="!border-rule !bg-ink-raised [&_button]:!border-rule
                               [&_button]:!bg-ink-raised [&_button]:!fill-paper-muted" />
          <MiniMap
            pannable
            className="!border !border-rule !bg-ink-sunken"
            maskColor="rgba(8,8,8,0.75)"
            nodeColor={(node) =>
              KIND_STYLE[(node.data as NodeData).kind]?.border ?? "#2e2c27"}
          />
        </ReactFlow>
      </div>

      <Legend />
    </div>
  );
}

function Legend() {
  const entries: [string, string][] = [
    ["SUPPORTS", EDGE_COLOR.SUPPORTS],
    ["CONTRADICTS", EDGE_COLOR.CONTRADICTS],
    ["PARTIALLY_SUPPORTS", EDGE_COLOR.PARTIALLY_SUPPORTS],
    ["OUTDATED", EDGE_COLOR.OUTDATED],
    ["CHALLENGES", EDGE_COLOR.CHALLENGES],
    ["PRODUCED", EDGE_COLOR.PRODUCED],
    ["SUPERSEDES", EDGE_COLOR.SUPERSEDES],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {entries.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-px w-4" style={{ background: color }} />
          <span className="font-mono text-[9px] tracking-[0.1em] text-paper-faint">
            {label}
          </span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-px w-4 border-t border-dashed border-rule-strong" />
        <span className="font-mono text-[9px] tracking-[0.1em] text-paper-faint">
          NOT YET ADJUDICATED
        </span>
      </span>
    </div>
  );
}
