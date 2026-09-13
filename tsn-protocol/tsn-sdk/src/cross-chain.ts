/** Public TSN-only primitives for optional Creditcoin attestations. */
import { TsnHttpClient } from "./client.js";
import type { CreateIntentRequest, TsnMempoolIntent } from "./contracts.js";

export const ATTESTCOIN_BLOCK_PROVER_PRECOMPILE =
  "0x0000000000000000000000000000000000000FD2" as const;

export type CrossChainNetwork =
  | "solana-devnet"
  | "creditcoin-testnet"
  | "base-sepolia"
  | "ethereum-sepolia";

export type AttestationStatus =
  | "not_requested"
  | "queued"
  | "anchored"
  | "verified"
  | "failed";

export const CREDITCOIN_SETTLEMENT_NETWORK = "creditcoin-testnet" as const;

export type CrossChainRecipient =
  | { kind: "tin"; tinHash: `0x${string}` }
  | { kind: "wallet"; address: `0x${string}` };

export function validateCrossChainRecipient(recipient: CrossChainRecipient): CrossChainRecipient {
  if (recipient.kind === "tin") {
    assertBytes32(recipient.tinHash, "tinHash");
    return recipient;
  }
  assertEvmAddress(recipient.address, "destination wallet");
  return recipient;
}

export interface CreditcoinPayoutAuthorization {
  settlementId: string;
  sealedTipHeadHash: string;
  tinHash: string;
  exitCommitment: string;
  destinationNetwork: typeof CREDITCOIN_SETTLEMENT_NETWORK;
  recipient: `0x${string}`;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  merchantOverride: boolean;
}

export function validateCreditcoinPayoutAuthorization(
  authorization: CreditcoinPayoutAuthorization,
): CreditcoinPayoutAuthorization {
  if (!/^0x[0-9a-fA-F]{40}$/.test(authorization.recipient)) {
    throw new Error("Creditcoin payout recipient must be a 20-byte EVM address");
  }
  for (const field of ["settlementId", "sealedTipHeadHash", "tinHash", "exitCommitment"] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(authorization[field])) {
      throw new Error(`${field} must be a bytes32 value`);
    }
  }
  if (authorization.destinationNetwork !== CREDITCOIN_SETTLEMENT_NETWORK) {
    throw new Error("only the Creditcoin settlement rail is enabled");
  }
  if (authorization.amount <= 0n || authorization.deadline <= 0n) {
    throw new Error("payout amount and deadline must be positive");
  }
  return authorization;
}

export interface CreditcoinDestination {
  network: "creditcoin-testnet";
  address: `0x${string}`;
  token: string;
}

export interface TinExitAttestationInput {
  settlementId: string;
  sourceNetwork: "solana-devnet";
  destinationNetwork: "creditcoin-testnet";
  sealedTipHeadHash: string;
  amount: bigint;
  tinHash: string;
  exitCommitment: string;
}

export interface TinExitAttestationReceipt {
  status: AttestationStatus;
  settlementId: string;
  destinationNetwork: "creditcoin-testnet";
  creditcoinTransaction?: string;
  sourceAnchorTransaction?: string;
}

export function validateCreditcoinDestination(
  destination: CreditcoinDestination,
): CreditcoinDestination {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination.address)) {
    throw new Error("Creditcoin destination must be a 20-byte EVM address");
  }
  if (!destination.token.trim()) {
    throw new Error("Creditcoin destination token is required");
  }
  return destination;
}

export function createTinExitReplayKey(
  input: Pick<
    TinExitAttestationInput,
    "sealedTipHeadHash" | "amount" | "tinHash" | "exitCommitment"
  >,
): string {
  return [
    input.sealedTipHeadHash,
    input.amount.toString(10),
    input.tinHash,
    input.exitCommitment,
  ].join(":");
}

export type VerifiedDestinationEvm = "base" | "ethereum";

export interface DestinationLiquidityRoute {
  routeId: `0x${string}`;
  network: VerifiedDestinationEvm;
  sourceChainKey: bigint;
  sourceLiquidityEmitter: `0x${string}`;
  payoutVault: `0x${string}`;
  settlementToken: `0x${string}`;
  enabled: boolean;
}

export interface VerifiedDestinationLiquidity {
  routeId: `0x${string}`;
  queryId: `0x${string}`;
  availableAmount: bigint;
  sourceBlock: bigint;
  validUntil: bigint;
  nonce: bigint;
}

export function assertVerifiedDestinationLiquidity(
  route: DestinationLiquidityRoute,
  observation: VerifiedDestinationLiquidity,
  requestedAmount: bigint,
  nowSeconds: bigint = BigInt(Math.floor(Date.now() / 1000)),
): void {
  if (!route.enabled) throw new Error("destination route is disabled");
  if (route.routeId !== observation.routeId) throw new Error("liquidity observation route mismatch");
  if (!/^0x[0-9a-fA-F]{40}$/.test(route.payoutVault)) throw new Error("invalid destination payout vault");
  if (!/^0x[0-9a-fA-F]{40}$/.test(route.settlementToken)) throw new Error("invalid destination settlement token");
  if (requestedAmount <= 0n || observation.availableAmount < requestedAmount) {
    throw new Error("verified destination liquidity is insufficient");
  }
  if (observation.validUntil <= nowSeconds) throw new Error("verified destination liquidity has expired");
}

/**
 * Live Creditcoin route evidence for terminal runners and the TSN test UI.
 *
 * The Node may mirror route identity for fast admission, but this client reads
 * the route registry and liquidity observation directly from Creditcoin. It
 * never accepts a token or executor address as runtime authority from UI data.
 */
export interface CreditcoinRouteClientConfig {
  rpcUrl: string;
  registry: `0x${string}`;
  routeId: `0x${string}`;
  expectedChainId?: bigint;
  explorerBaseUrl?: string;
}

export interface CreditcoinRouteState {
  chainId: bigint;
  routeId: `0x${string}`;
  enabled: boolean;
  payoutVault: `0x${string}`;
  settlementToken: `0x${string}`;
  destinationNetwork: `0x${string}`;
  destinationChainId: bigint;
  destinationExecutor: `0x${string}`;
  outbox: `0x${string}`;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

export interface CreditcoinLiquidityState {
  availableAmount: bigint;
  sourceBlock: bigint;
  observedAt: bigint;
  validUntil: bigint;
  nonce: bigint;
  queryId: `0x${string}`;
  isFresh: boolean;
}

export interface CreditcoinRouteEvidence {
  status: "ready" | "blocked";
  route: CreditcoinRouteState;
  liquidity: CreditcoinLiquidityState;
  logs: string[];
  explorerLinks: { registry: string; token: string; vault: string };
  failure?: string;
}

const DIRECT_ROUTE_GETTER = "0xe9207600";
const DIRECT_LIQUIDITY_GETTER = "0xa2fb18c1";
const DIRECT_ACTIVE_GETTER = "0x655d0aa8";
const ERC20_NAME = "0x06fdde03";
const ERC20_SYMBOL = "0x95d89b41";
const ERC20_DECIMALS = "0x313ce567";

function assertEvmAddress(value: string, field: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${field} must be a 20-byte EVM address`);
  return value as `0x${string}`;
}

function assertBytes32(value: string, field: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${field} must be bytes32`);
  return value as `0x${string}`;
}

function word(data: string, index: number): bigint {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  const value = raw.slice(index * 64, (index + 1) * 64);
  if (value.length !== 64) throw new Error("Creditcoin RPC returned malformed ABI data");
  return BigInt(`0x${value}`);
}

function wordAddress(data: string, index: number): `0x${string}` {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  return assertEvmAddress(`0x${raw.slice(index * 64 + 24, index * 64 + 64)}`, `route word ${index}`);
}

function wordBytes32(data: string, index: number): `0x${string}` {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  return assertBytes32(`0x${raw.slice(index * 64, (index + 1) * 64)}`, `route word ${index}`);
}

function decodeAbiString(data: string): string | undefined {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  if (raw.length < 128) return undefined;
  const offset = Number(BigInt(`0x${raw.slice(0, 64)}`)) * 2;
  if (offset + 64 > raw.length) return undefined;
  const length = Number(BigInt(`0x${raw.slice(offset, offset + 64)}`));
  const bytes = raw.slice(offset + 64, offset + 64 + length * 2);
  try { return new TextDecoder().decode(Uint8Array.from(bytes.match(/.{1,2}/g) ?? [], (byte) => parseInt(byte, 16))); }
  catch { return undefined; }
}

export class CreditcoinRouteClient {
  private readonly config: Required<CreditcoinRouteClientConfig>;

  constructor(config: CreditcoinRouteClientConfig) {
    this.config = {
      expectedChainId: 102031n,
      explorerBaseUrl: "https://creditcoin-testnet.blockscout.com",
      ...config,
    };
    assertEvmAddress(this.config.registry, "registry");
    assertBytes32(this.config.routeId, "routeId");
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`Creditcoin RPC HTTP ${response.status}`);
    const body = await response.json() as { result?: T; error?: { message?: string } };
    if (body.error || body.result === undefined) throw new Error(body.error?.message ?? "Creditcoin RPC returned no result");
    return body.result;
  }

  private async call(to: string, data: string): Promise<string> {
    return this.rpc<string>("eth_call", [{ to, data }, "latest"]);
  }

  async readRoute(): Promise<CreditcoinRouteState> {
    const chainId = BigInt(await this.rpc<string>("eth_chainId", []));
    if (chainId !== this.config.expectedChainId) throw new Error(`expected Creditcoin chain ${this.config.expectedChainId}, received ${chainId}`);
    const raw = await this.call(this.config.registry, DIRECT_ROUTE_GETTER + this.config.routeId.slice(2));
    const token = wordAddress(raw, 4);
    const [tokenName, tokenSymbol, decimalsRaw] = await Promise.all([
      this.call(token, ERC20_NAME).then(decodeAbiString),
      this.call(token, ERC20_SYMBOL).then(decodeAbiString),
      this.call(token, ERC20_DECIMALS).then((value) => Number(word(value, 0))),
    ]);
    return {
      chainId,
      routeId: this.config.routeId,
      enabled: word(raw, 0) === 1n,
      payoutVault: wordAddress(raw, 3),
      settlementToken: token,
      destinationNetwork: wordBytes32(raw, 5),
      destinationChainId: word(raw, 6),
      destinationExecutor: wordAddress(raw, 7),
      outbox: wordAddress(raw, 8),
      tokenName,
      tokenSymbol,
      tokenDecimals: decimalsRaw,
    };
  }

  async readLiquidity(): Promise<CreditcoinLiquidityState> {
    const raw = await this.call(this.config.registry, DIRECT_LIQUIDITY_GETTER + this.config.routeId.slice(2));
    const validUntil = word(raw, 3);
    return {
      availableAmount: word(raw, 0),
      sourceBlock: word(raw, 1),
      observedAt: word(raw, 2),
      validUntil,
      nonce: word(raw, 4),
      queryId: wordBytes32(raw, 5),
      isFresh: validUntil > BigInt(Math.floor(Date.now() / 1000)),
    };
  }

  async readEvidence(): Promise<CreditcoinRouteEvidence> {
    const logs: string[] = ["Checking Creditcoin chain ID...", "Reading route from on-chain registry..."];
    try {
      const [route, liquidity, activeRaw] = await Promise.all([
        this.readRoute(),
        this.readLiquidity(),
        this.call(this.config.registry, DIRECT_ACTIVE_GETTER + this.config.routeId.slice(2)),
      ]);
      const active = word(activeRaw, 0) === 1n;
      logs.push(`Route: ${active && route.enabled ? "active" : "inactive"}`);
      logs.push(`Settlement asset: ${route.tokenSymbol ?? "unknown"} ${route.settlementToken}`);
      logs.push(`Vault liquidity: ${liquidity.availableAmount.toString(10)} base units`);
      logs.push(`Liquidity observation: ${liquidity.isFresh ? "fresh" : "expired"}`);
      const status = active && route.enabled && liquidity.isFresh && liquidity.availableAmount > 0n ? "ready" : "blocked";
      if (status === "blocked") logs.push("Route gate: blocked by on-chain state");
      else logs.push("Route gate: ready for Node authorization");
      return {
        status,
        route,
        liquidity,
        logs,
        explorerLinks: {
          registry: `${this.config.explorerBaseUrl}/address/${this.config.registry}`,
          token: `${this.config.explorerBaseUrl}/address/${route.settlementToken}`,
          vault: `${this.config.explorerBaseUrl}/address/${route.payoutVault}`,
        },
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      logs.push(`Route gate: failed (${failure})`);
      return {
        status: "blocked",
        route: await this.readRoute(),
        liquidity: await this.readLiquidity(),
        logs,
        explorerLinks: {
          registry: `${this.config.explorerBaseUrl}/address/${this.config.registry}`,
          token: `${this.config.explorerBaseUrl}/address/${this.config.registry}`,
          vault: `${this.config.explorerBaseUrl}/address/${this.config.registry}`,
        },
        failure,
      };
    }
  }
}

export interface CrossChainUiSnapshot {
  status: "ready" | "blocked";
  logs: string[];
  nodeRoutes: unknown[];
  creditcoin: CreditcoinRouteEvidence;
}

/**
 * One UI-facing preflight that mirrors the terminal order:
 * Node route gate first, then live Creditcoin registry/liquidity evidence.
 */
export async function loadCrossChainUiSnapshot(input: {
  nodeUrl: string;
  route: CreditcoinRouteClientConfig;
}): Promise<CrossChainUiSnapshot> {
  const logs = ["Checking TSN Node route gate..."];
  let nodeRoutes: unknown[] = [];
  try {
    const response = await fetch(`${input.nodeUrl.replace(/\/$/, "")}/settlement-networks`);
    if (!response.ok) throw new Error(`Node route gate HTTP ${response.status}`);
    const body = await response.json() as { value?: unknown[] } | unknown[];
    nodeRoutes = Array.isArray(body) ? body : body.value ?? [];
    logs.push(`Node route gate: ${nodeRoutes.length} configured route(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`Node route gate: failed (${message})`);
  }

  const creditcoin = await new CreditcoinRouteClient(input.route).readEvidence();
  logs.push(...creditcoin.logs);
  const status = nodeRoutes.length > 0 && creditcoin.status === "ready" ? "ready" : "blocked";
  logs.push(`Cross-chain UI preflight: ${status}`);
  return { status, logs, nodeRoutes, creditcoin };
}

/**
 * Application-facing TSN cross-chain façade.
 *
 * This class coordinates calls to the existing Node and registry reader. It
 * deliberately does not sign Solana transactions, submit EVM transactions,
 * generate Attestcoin proofs, or choose an executor. Those responsibilities
 * remain with the Solana programs, Node, Attestcoin contracts, and Crankers.
 */
export class TsnCrossChainClient {
  private readonly nodeUrl: string;
  private readonly node: TsnHttpClient;
  private readonly route: CreditcoinRouteClient;
  private readonly routeConfig: CreditcoinRouteClientConfig;

  constructor(input: {
    nodeUrl: string;
    route: CreditcoinRouteClientConfig;
    apiKey?: string | null;
    fetchImpl?: typeof fetch;
  }) {
    this.nodeUrl = input.nodeUrl.replace(/\/$/, "");
    this.node = new TsnHttpClient({
      baseUrl: this.nodeUrl,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
    });
    this.routeConfig = input.route;
    this.route = new CreditcoinRouteClient(input.route);
  }

  /** Returns only routes admitted by the running Node gate. */
  getSettlementNetworks(): Promise<unknown> {
    return this.node.get("/settlement-networks");
  }

  /** Runs the same Node-gate then Creditcoin-registry preflight used by the UI. */
  preflight(): Promise<CrossChainUiSnapshot> {
    return loadCrossChainUiSnapshot({
      nodeUrl: this.nodeUrl,
      route: this.routeConfig,
    });
  }

  /** Submits an already signed TSN debit intent to the Node. */
  submitDebitIntent(request: CreateIntentRequest): Promise<TsnMempoolIntent> {
    if (request.destinationNetwork !== CREDITCOIN_SETTLEMENT_NETWORK) {
      throw new Error("cross-chain debit intent must target an enabled TSN destination");
    }
    if (!request.destinationExecutor || !request.destinationToken || !request.settlementRouteId) {
      throw new Error("cross-chain debit intent requires registry-bound executor, token, and route ID");
    }
    return this.node.postIntent<CreateIntentRequest, TsnMempoolIntent>(request);
  }

  /** Reads live Creditcoin route and liquidity evidence without submitting a transaction. */
  readCreditcoinEvidence(): Promise<CreditcoinRouteEvidence> {
    return this.route.readEvidence();
  }

  /**
   * Produces the exact handoff object a Cranker may submit. The SDK never
   * broadcasts it; a Cranker must enforce its own network and signer policy.
   */
  createCrankerHandoff(input: {
    authorization: CreditcoinPayoutAuthorization;
    signature: string;
  }): { network: typeof CREDITCOIN_SETTLEMENT_NETWORK; authorization: CreditcoinPayoutAuthorization; signature: string } {
    return {
      network: CREDITCOIN_SETTLEMENT_NETWORK,
      authorization: validateCreditcoinPayoutAuthorization(input.authorization),
      signature: input.signature,
    };
  }
}
