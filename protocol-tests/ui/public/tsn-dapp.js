(() => {
  let session;
  let pendingPayment;
  let networkStatus;
  let activeWallet;
  const events = [];
  const $ = (id) => document.getElementById(id);

  function walletCandidate() {
    const candidates = [
      ["Solflare", window.solflare],
      ["Solflare", window.solana?.isSolflare ? window.solana : null],
      ["Phantom", window.phantom?.solana],
      ["Backpack", window.backpack?.solana],
      ["Browser wallet", window.solana],
    ];
    return candidates.find(([, wallet]) => wallet?.connect) ?? [null, null];
  }

  function short(value, max = 88) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  }

  function log(title, value = "") {
    events.unshift({ time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), title, value });
    events.splice(8);
    $("activity").innerHTML = events.map((entry) => `<div class="event"><time>${entry.time}</time><span><b>${entry.title}</b>${entry.value ? ` - ${short(entry.value)}` : ""}</span></div>`).join("");
    $("log").textContent = events.map((entry) => `${entry.time}  ${entry.title}\n${typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value, null, 2)}`).join("\n\n");
  }

  async function read(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
    return body;
  }

  async function api(url, options = {}) {
    session ??= await fetch("/api/session", { method: "POST" }).then(read);
    return fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-trustlink-session": session.sessionId,
        "x-trustlink-csrf": session.csrfToken,
        ...(options.headers ?? {}),
      },
    }).then(read);
  }

  function selectTab(tabId) {
    document.querySelectorAll('[role="tab"]').forEach((tab) => {
      const selected = tab.id === tabId;
      tab.setAttribute("aria-selected", String(selected));
      $(tab.getAttribute("aria-controls")).classList.toggle("active", selected);
    });
  }

  function renderNetworkStatus(status) {
    networkStatus = status;
    const selectedByService = new Map(Object.entries(status.selected ?? {}).map(([service, selected]) => [service, selected]));
    const services = ["node", "receiver", "rpc", "cranker"].map((service) => {
      const item = [...status.services].reverse().find((entry) => entry.service === service && entry.state === "online")
        ?? status.services.find((entry) => entry.service === service)
        ?? { service, state: "unknown", source: "none" };
      const selected = selectedByService.get(service);
      const detail = selected?.url ? `${item.source} / ${selected.url.replace(/^https?:\/\//, "")}` : item.detail ?? item.source;
      return `<div class="status-card"><span>${service.toUpperCase()}</span><strong class="state-${item.state}">${item.state.toUpperCase()}</strong><small title="${detail}">${short(detail, 34)}</small></div>`;
    });
    const transactionState = status.readyForTransactions ? "READY" : "BLOCKED";
    $("serviceStatus").innerHTML = `<div class="status-grid">${services.join("")}</div><div class="status-summary">Routes: ${status.routeCount} / Crankers: ${status.onlineCrankers ?? "not reported"} / Transactions: <b class="state-${status.readyForTransactions ? "online" : "offline"}">${transactionState}</b></div>`;
  }

  async function refreshStatus() {
    try {
      const status = await api("/api/tsn/sdk/network-status");
      renderNetworkStatus(status);
      const rpc = status.selected?.rpc;
      log("SDK getTsnNetworkStatus", rpc?.url ? `RPC: ${rpc.source} / ${rpc.url}` : "No RPC selected");
    } catch (error) {
      networkStatus = null;
      $("serviceStatus").textContent = `Status check failed: ${error.message}`;
      log("NETWORK STATUS BLOCKED", error.message);
    }
  }

  async function connectWallet() {
    try {
      const [name, wallet] = walletCandidate();
      if (!wallet) throw new Error("Solflare was not detected. Unlock Solflare and allow the extension on localhost.");
      const connected = await wallet.connect();
      const publicKey = (connected.publicKey ?? wallet.publicKey)?.toBase58();
      if (!publicKey) throw new Error("Wallet did not return a Solana public key.");
      activeWallet = wallet;
      await api("/api/session/wallet", { method: "POST", body: JSON.stringify({ publicKey }) });
      $("walletStatus").textContent = `${name} connected`;
      $("walletKey").textContent = publicKey;
      $("connectWallet").textContent = "Connected";
      $("connectWallet").disabled = true;
      log("WALLET CONNECTED", `${name} / ${publicKey}`);
    } catch (error) {
      log("WALLET CONNECTION BLOCKED", error.message);
    }
  }

  async function sign(message) {
    if (!activeWallet?.signMessage) throw new Error("The connected wallet must support signMessage.");
    const signed = await activeWallet.signMessage(new TextEncoder().encode(message), "utf8");
    return btoa(String.fromCharCode(...signed.signature));
  }

  function requireWallet() {
    if (!session || !activeWallet) throw new Error("Connect Solflare or another browser wallet first.");
  }

  function requireNetwork() {
    if (!networkStatus?.readyForTransactions) throw new Error("TSN services are not ready. Refresh Status before creating a transaction.");
  }

  async function payTin() {
    try {
      requireWallet();
      requireNetwork();
      const recipientTin = $("recipientTin").value.trim();
      const route = await api("/api/tsn/sdk/resolve-tin", { method: "POST", body: JSON.stringify({ tin: recipientTin }) });
      pendingPayment = await api("/api/tsn/sdk/prepare-payment", {
        method: "POST",
        body: JSON.stringify({ recipientTin, recipientRouteCommitment: route.recipientRouteCommitment, recipientRouteVersion: route.recipientRouteVersion, tokenMintAddress: $("tinMint").value.trim(), amount: Number($("tinAmount").value) }),
      });
      $("submitTin").disabled = false;
      log("SDK createPaymentAuthorization", `TIN ${recipientTin} / ready for wallet signature`);
    } catch (error) { log("TIN PAYMENT BLOCKED", error.message); }
  }

  async function submitTin() {
    try {
      if (!pendingPayment) throw new Error("Prepare the TIN payment first.");
      const signatureBase64 = await sign(pendingPayment.message);
      const submitted = await api("/api/tsn/sdk/submit-payment", { method: "POST", body: JSON.stringify({ ...pendingPayment, signatureBase64 }) });
      $("submitTin").disabled = true;
      log("SDK submitPaymentAuthorizationToMempool", submitted.status ?? "Intent submitted");
    } catch (error) { log("INTENT SUBMISSION BLOCKED", error.message); }
  }

  async function buildWalletTransfer() {
    try {
      requireWallet();
      requireNetwork();
      const transfer = await api("/api/tsn/sdk/build-wallet-transfer", { method: "POST", body: JSON.stringify({ recipientWallet: $("walletRecipient").value.trim(), tokenMintAddress: $("walletMint").value.trim(), amountUi: $("walletAmount").value, tokenDecimals: 6 }) });
      log("SDK buildTsnSplTokenTransferTransaction", transfer.status ?? "Unsigned transfer ready");
    } catch (error) { log("WALLET TRANSFER BLOCKED", error.message); }
  }

  async function buildFunding() {
    try {
      requireWallet();
      requireNetwork();
      const funding = await api("/api/tsn/sdk/build-funding", { method: "POST", body: JSON.stringify({ tokenMintAddress: $("fundingMint").value.trim(), amountUi: $("fundingAmount").value, tokenDecimals: 6 }) });
      log("SDK buildTsnSponsoredSettlementTransaction", funding.status ?? "Unsigned funding ready");
    } catch (error) { log("FUNDING BUILD BLOCKED", error.message); }
  }

  document.querySelectorAll('[role="tab"]').forEach((tab) => { tab.onclick = () => selectTab(tab.id); });
  $("connectWallet").onclick = connectWallet;
  $("refreshStatus").onclick = refreshStatus;
  $("payTin").onclick = payTin;
  $("submitTin").onclick = submitTin;
  $("buildWalletTransfer").onclick = buildWalletTransfer;
  $("buildFunding").onclick = buildFunding;
  $("clearActivity").onclick = () => { events.splice(0); $("activity").innerHTML = '<div class="event"><time>CLEAR</time><span>Activity cleared.</span></div>'; $("log").textContent = "Activity cleared."; };
  const [walletName] = walletCandidate();
  if (walletName) $("walletKey").textContent = `${walletName} detected. Connect when ready.`;
  log("READY", walletName ? `${walletName} detected` : "No browser wallet detected");
  refreshStatus();
})();
