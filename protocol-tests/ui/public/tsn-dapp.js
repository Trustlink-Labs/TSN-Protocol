(() => {
    let session = null;
    const api = async (url, options = {}) => {
        session = session ?? window.trustlinkLabSession ?? await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
        window.trustlinkLabSession = session;
        const headers = { 'content-type': 'application/json', 'x-trustlink-session': session.sessionId, 'x-trustlink-csrf': session.csrfToken, ...(options.headers ?? {}) };
        const response = await fetch(url, { ...options, headers });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `HTTP_${response.status}`);
        return body;
    };
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const result = (value) => { const node = document.querySelector('#tsnResult'); if (node) node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
    const wallet = () => window.trustlinkLabWallet?.publicKey;
    const requireWallet = () => { if (!wallet()) throw new Error('Load or connect a wallet first from the Wallet panel.'); return wallet(); };
    function injectStyles() {
        if (document.querySelector('#tsnDappStyles')) return;
        const style = document.createElement('style');
        style.id = 'tsnDappStyles';
        style.textContent = `.tsn-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.tsn-hero h2{margin:0 0 5px}.tsn-kicker{color:#78aefd;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.tsn-status{min-width:150px;padding:9px 10px;border:1px solid #263b58;border-radius:7px;background:#0d192a;color:#92a9c6;font-size:11px}.tsn-status strong{display:block;color:#edbd67;margin-top:3px}.tsn-card{display:flex;flex-direction:column;gap:9px}.tsn-card h3{margin:0;color:#e9f2ff;font-size:13px;text-transform:none;letter-spacing:0}.tsn-card .small{margin:0;line-height:1.45}.tsn-card label{display:flex;flex-direction:column;gap:4px;color:#92a9c6;font-size:11px}.tsn-card input{width:100%;min-height:34px;margin:0;padding:8px 9px;border:1px solid #355071;border-radius:6px;background:#0b1727;color:#e9f2ff;font:12px ui-monospace,monospace}.tsn-card input:focus{outline:2px solid #78aefd;outline-offset:1px;border-color:#78aefd}.tsn-card button{align-self:flex-start;background:#1f5a3d;border-color:#52d69e;font-weight:700}.tsn-card button:hover{background:#28714d}.tsn-card code{display:block;overflow:auto;padding:8px;border-radius:5px;background:#07101d;color:#edbd67;font-size:11px}.tsn-result{margin-top:12px;padding:12px;border:1px solid #263b58;border-radius:7px;background:#07101d}.tsn-card--muted{opacity:.82}.tsn-section-label{grid-column:1/-1;margin:7px 2px 0;color:#92a9c6;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}@media(max-width:800px){.tsn-hero{display:block}.tsn-status{margin-top:10px}.tsn-section-label{grid-column:auto}}`;
        document.head.appendChild(style);
    }
    async function sign(message) {
        const provider = window.solana ?? window.phantom?.solana ?? window.backpack?.solana;
        if (!provider?.signMessage) throw new Error('This action requires a browser wallet with signMessage.');
        const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
        return btoa(String.fromCharCode(...signed.signature));
    }
    function addGroup() {
        const scroll = document.querySelector('.left .scroll'); if (!scroll || document.querySelector('#tsnDappGroup')) return;
        const group = document.createElement('div'); group.id = 'tsnDappGroup'; group.className = 'group active'; group.innerHTML = '<b>TSN Wallet Dapp</b><p class="small">TIN, payment authorization, and settlement builders</p><button onclick="startTsnDapp()">Open dapp</button>'; scroll.prepend(group);
    }
    window.startTsnDapp = () => {
        document.querySelectorAll('.left .group').forEach((item) => item.classList.toggle('active', item.id === 'tsnDappGroup'));
        document.querySelector('#session').textContent = 'Session: TSN Wallet Dapp';
        injectStyles();
        document.querySelector('#scene').innerHTML = `<div class="tsn-hero"><div><div class="tsn-kicker">Developer sandbox</div><h2>TSN Wallet Dapp</h2><p class="small">Prepare identity, payment, and settlement actions with the SDK. Every signature and submission stays explicit.</p></div><div class="tsn-status">NETWORK<strong>DEVNET</strong></div></div><div class="cards">
            <div class="card tsn-card"><h3>Create a TIN</h3><p class="small">The TIP program/TSN Cranker must assign the 10-digit TIN. You provide only the display name; the user never chooses the number.</p><label for="tinName">Display name <input id="tinName" placeholder="Alice" autocomplete="name" required></label><button id="prepareTin">Request TIP assignment</button><p class="small warn">Allocator wiring is not available in the current SDK/Node contract yet. No fake TIN is generated by this UI.</p></div>
            <div class="card tsn-card"><h3>Wallet-to-wallet payment</h3><p class="small">Send tokens directly from the connected wallet to another wallet. This path does not use TIN routing.</p><label for="recipientWallet">Recipient wallet address <input id="recipientWallet" pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" placeholder="Solana wallet address" autocomplete="off" required></label><label for="paymentAmount">Amount <input id="paymentAmount" type="number" value="1" min="0.000001" step="0.000001" required></label><label for="paymentDecimals">Token decimals <input id="paymentDecimals" type="number" value="6" min="0" max="18" required></label><label for="paymentMint">Token mint <input id="paymentMint" value="${escapeHtml(window.trustlinkLabWallet?.selectedMint ?? '')}" placeholder="SPL mint" autocomplete="off" required></label><button id="preparePayment">Build transfer</button></div>
            <div class="tsn-section-label">Settlement builders</div>
            <div class="card tsn-card"><h3>Wallet deposit to credit TIN</h3><p class="small">Build the epoch-treasury funding transaction. Node authorization and TCAP credit remain separate stages.</p><label for="fundingMint">Token mint <input id="fundingMint" placeholder="SPL mint" autocomplete="off" required></label><label for="fundingAmount">Amount <input id="fundingAmount" value="1" type="number" min="0.000001" step="0.000001" required></label><label for="fundingDecimals">Token decimals <input id="fundingDecimals" value="6" type="number" min="0" max="18" required></label><button id="buildFunding">Build SDK funding transaction</button></div>
            <div class="card tsn-card tsn-card--muted"><h3>Debit to credit</h3><p class="small">The TSN SDK does not yet export these instruction builders. The checked-in protocol runner remains the executable reference.</p><code>npm run tcap:one-time:debit-credit:devnet</code></div>
            <div class="card tsn-card tsn-card--muted"><h3>Debit to exit</h3><p class="small">The protocol package has exit builders, but the dapp still needs a permit and account-data form before live submission.</p><code>npm run tcap:one-time:exit:devnet</code></div>
        </div><pre id="tsnResult" class="tsn-result">Load a wallet from the Wallet panel, then choose an action.</pre>`;
        document.querySelector('#prepareTin').onclick = () => runValidated(['tinName'], prepareTin);
        document.querySelector('#preparePayment').onclick = () => runValidated(['recipientWallet', 'paymentAmount', 'paymentDecimals', 'paymentMint'], preparePayment);
        document.querySelector('#buildFunding').onclick = () => runValidated(['fundingMint', 'fundingAmount', 'fundingDecimals'], buildFunding);
    };
    function runValidated(ids, action) {
        const invalid = ids.map((id) => document.querySelector(`#${id}`)).find((field) => !field?.reportValidity());
        if (!invalid) action();
    }
    async function prepareTin() {
        try { requireWallet(); const draft = await api('/api/tsn/sdk/prepare-tin', { method: 'POST', body: JSON.stringify({ displayName: document.querySelector('#tinName').value }) }); const signatureBase64 = await sign(draft.message); result({ ...draft, signatureBase64, next: 'POST the full encrypted TIN operation to the TSN Node /tin-operations endpoint.' }); } catch (error) { result(`BLOCKED: ${error.message}`); }
    }
    async function preparePayment() {
        try { requireWallet(); const transfer = await api('/api/tsn/sdk/prepare-wallet-transfer', { method: 'POST', body: JSON.stringify({ recipientWallet: document.querySelector('#recipientWallet').value, amountUi: document.querySelector('#paymentAmount').value, tokenDecimals: document.querySelector('#paymentDecimals').value, tokenMintAddress: document.querySelector('#paymentMint').value }) }); result({ ...transfer, next: 'Review the unsigned transaction and sign it with the connected wallet.' }); } catch (error) { result(`BLOCKED: ${error.message}`); }
    }
    async function buildFunding() {
        try { requireWallet(); const funding = await api('/api/tsn/sdk/build-funding', { method: 'POST', body: JSON.stringify({ tokenMintAddress: document.querySelector('#fundingMint').value, amountUi: document.querySelector('#fundingAmount').value, tokenDecimals: document.querySelector('#fundingDecimals').value }) }); result(funding); } catch (error) { result(`BLOCKED: ${error.message}`); }
    }
    addGroup();
    startTsnDapp();
})();
