document.addEventListener("DOMContentLoaded", async () => {
  const serverUrlInput = document.getElementById("serverUrl");
  const saveBtn = document.getElementById("saveUrl");
  const statusEl = document.getElementById("serverStatus");

  // Load saved server URL
  const config = await chrome.storage.local.get("server_url");
  if (config.server_url) {
    serverUrlInput.value = config.server_url;
  }

  saveBtn.addEventListener("click", async () => {
    const url = serverUrlInput.value.trim().replace(/\/+$/, "");
    await chrome.storage.local.set({ server_url: url });

    // Test connection
    try {
      const resp = await fetch(`${url}/opens`);
      if (resp.ok) {
        statusEl.textContent = "Connected!";
        statusEl.className = "status ok";
      } else {
        statusEl.textContent = "Server responded with error";
        statusEl.className = "status err";
      }
    } catch {
      statusEl.textContent = "Cannot reach server";
      statusEl.className = "status err";
    }
  });

  // Load tracked emails
  const result = await chrome.storage.local.get("tracking_mappings");
  const mappings = result.tracking_mappings || {};
  const entries = Object.entries(mappings).reverse();

  const serverUrl = config.server_url || "http://localhost:3000";

  let totalOpened = 0;
  let totalOpens = 0;

  const listEl = document.getElementById("list");

  if (entries.length === 0) return;

  listEl.innerHTML = "";

  // Fetch open data for all tracked emails
  for (const [trackingId, data] of entries) {
    let openCount = 0;
    let lastOpen = null;

    try {
      const resp = await fetch(`${serverUrl}/opens?id=${trackingId}`);
      const openData = await resp.json();
      openCount = openData.openCount || 0;
      if (openData.opens && openData.opens.length) {
        lastOpen = openData.opens[openData.opens.length - 1].timestamp;
      }
    } catch {
      // Server unavailable
    }

    if (openCount > 0) totalOpened++;
    totalOpens += openCount;

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="to">${escapeHtml(data.recipient)}</div>
      <div class="subject">${escapeHtml(data.subject)}</div>
      <div class="meta">
        <span>Sent ${formatDate(data.sentAt)}</span>
        <span class="opens ${openCount > 0 ? "read" : "unread"}">
          ${openCount > 0 ? `Opened ${openCount}x` : "Not opened"}
        </span>
      </div>
      ${lastOpen ? `<div class="meta"><span>Last opened: ${formatDate(lastOpen)}</span></div>` : ""}
    `;
    listEl.appendChild(item);
  }

  document.getElementById("totalSent").textContent = entries.length;
  document.getElementById("totalOpened").textContent = totalOpened;
  document.getElementById("totalOpens").textContent = totalOpens;
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
