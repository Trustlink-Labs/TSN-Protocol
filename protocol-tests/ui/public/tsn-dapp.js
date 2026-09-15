(() => {
  let session;
  let pendingPayment;
  let networkStatus;
  const $ = (id) => document.getElementById(id);
  const log = (title, value) => {
    $("log").textContent = `${new Date().toLocaleTimeString()}  ${title}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n\n${$("log").textContent}`;
  };
  async function api(url, options = {}) {
    session ??= await fetch("/api/session", { method: "POST" }).then(read);
    const response = await fetch(url, { ...options, headers: { "content-type": "application/json", "x-trustlink-session": session.sessionId, "x-trustlink-csrf": session.csrfToken, ...(options.headers ?? {}) } });
    return read(response);
  }
  async function read(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
    return body;
  }
  function provider() { return window.solana ?? window.phantom?.solana ?? window.backpack?.solana; }
  async function connectWallet() {
    try {
      const wallet = provider();
      if (!wallet?.connect) throw new Error("Install or unlock a browser wallet first.");
      const connected = await wallet.connect();
      const publicKey = connected.publicKey.toBase58();
      await api("/api/session/wallet", { method: "POST", body: JSON.stringify({ publicKey }) });
      $("walletStatus").textContent = "Browser wallet connected";
      $("walletKey").textContent = publicKey;
      $("connectWallet").textContent = "Connected";
      $("connectWallet").disabled = true;
      log("WALLET_CONNECTED", { publicKey, boundary: "browser wallet only" });
    } catch (error) { log("WALLET_CONNECTION_BLOCKED", error.message); }
  }
  async function sign(message) {
    const wallet = provider();
    if (!wallet?.signMessage) throw new Error("Connected wallet must support signMessage.");
    const signed = await wallet.signMessage(new TextEncoder().encode(message), "utf8");
    return btoa(String.fromCharCode(...signed.signature));
  }
  function requireWallet() { if (!session || !$("connectWallet").disabled) throw new Error("Connect a browser wallet first."); }
  function requireNetwork() {
    if (!networkStatus?.readyForTransactions) throw new Error("TSN services are not ready. Refresh network status before creating a transaction.");
  }
  function renderNetworkStatus(status) {
    networkStatus = status;
    $("serviceStatus").innerHTML = status.services.map((item) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #e9e0c8"><span><b>${item.service.toUpperCase()}</b> <small>${item.source}</small></span><strong style="color:${item.state === "online" ? "#2F7B4C" : item.state === "unknown" ? "#8C7330" : "#9E2B25"}">${item.state.toUpperCase()}</strong></div>`).join("") + `<p style="margin:9px 0 0;font-size:12px;color:#3A463C">Routes: ${status.routeCount} · Online Crankers: ${status.onlineCrankers ?? "not reported"} · Transactions: ${status.readyForTransactions ? "READY" : "BLOCKED"}</p>`;
  }
  async function refreshStatus() {
    try { const status = await api("/api/tsn/sdk/network-status"); renderNetworkStatus(status); log("SDK · getTsnNetworkStatus", status); }
    catch (error) { networkStatus = null; $("serviceStatus").textContent = `Status check failed: ${error.message}`; log("NETWORK_STATUS_BLOCKED", error.message); }
  }
  async function payTin() {
    try {
      requireWallet(); requireNetwork();
      const recipientTin = $("recipientTin").value.trim();
      const route = await api("/api/tsn/sdk/resolve-tin", { method: "POST", body: JSON.stringify({ tin: recipientTin }) });
      log("SDK · resolveTinRoute", route);
      pendingPayment = await api("/api/tsn/sdk/prepare-payment", { method: "POST", body: JSON.stringify({ recipientTin, recipientRouteCommitment: route.recipientRouteCommitment, recipientRouteVersion: route.recipientRouteVersion, tokenMintAddress: $("tinMint").value.trim(), amount: Number($("tinAmount").value) }) });
      $("submitTin").disabled = false;
      log("SDK · createPaymentAuthorization", pendingPayment);
    } catch (error) { log("TIN_PAYMENT_BLOCKED", error.message); }
  }
  async function submitTin() {
    try {
      if (!pendingPayment) throw new Error("Prepare the TIN payment first.");
      const signatureBase64 = await sign(pendingPayment.message);
      const submitted = await api("/api/tsn/sdk/submit-payment", { method: "POST", body: JSON.stringify({ ...pendingPayment, signatureBase64 }) });
      log("SDK · submitPaymentAuthorizationToMempool", submitted);
      $("submitTin").disabled = true;
    } catch (error) { log("INTENT_SUBMISSION_BLOCKED", error.message); }
  }
  async function buildWalletTransfer() {
    try {
      requireWallet(); requireNetwork();
      const transfer = await api("/api/tsn/sdk/build-wallet-transfer", { method: "POST", body: JSON.stringify({ recipientWallet: $("walletRecipient").value.trim(), tokenMintAddress: $("walletMint").value.trim(), amountUi: $("walletAmount").value, tokenDecimals: 6 }) });
      log("SDK · buildTsnSplTokenTransferTransaction", transfer);
    } catch (error) { log("WALLET_TRANSFER_BLOCKED", error.message); }
  }
  async function buildFunding() {
    try {
      requireWallet(); requireNetwork();
      const funding = await api("/api/tsn/sdk/build-funding", { method: "POST", body: JSON.stringify({ tokenMintAddress: $("fundingMint").value.trim(), amountUi: $("fundingAmount").value, tokenDecimals: 6 }) });
      log("SDK · buildTsnSponsoredSettlementTransaction", funding);
    } catch (error) { log("FUNDING_BUILD_BLOCKED", error.message); }
  }
  $("connectWallet").onclick = connectWallet;
  $("payTin").onclick = payTin;
  $("submitTin").onclick = submitTin;
  $("buildWalletTransfer").onclick = buildWalletTransfer;
  $("buildFunding").onclick = buildFunding;
  $("refreshStatus").onclick = refreshStatus;
  log("READY", { application: "TSN Protocol UI", sdk: "@trustlink/tsn-sdk", network: "Solana Devnet" });
  refreshStatus();
})();
