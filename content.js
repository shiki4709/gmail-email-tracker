// Content script - runs inside Gmail
// Injects tracking pixels into outgoing emails and shows open status

(function () {
  "use strict";

  // ===== CONFIGURATION =====
  let SERVER_URL = "http://localhost:3000";

  // Load server URL from extension storage
  chrome.storage.local.get("server_url", (result) => {
    if (result.server_url) SERVER_URL = result.server_url;
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.server_url) SERVER_URL = changes.server_url.newValue;
  });

  const POLL_INTERVAL = 30000; // Check for opens every 30 seconds
  const CHECKMARK_SENT = "\u2713"; // single check ✓
  const CHECKMARK_READ = "\u2713\u2713"; // double check ✓✓

  // ===== TRACKING PIXEL INJECTION =====

  // Watch for the Gmail send button click
  function observeSendButton() {
    const observer = new MutationObserver(() => {
      // Look for compose windows
      const composeWindows = document.querySelectorAll(
        'div[role="dialog"], .nH .iN'
      );
      composeWindows.forEach((win) => {
        if (win.dataset.trackerAttached) return;
        win.dataset.trackerAttached = "true";
        attachToCompose(win);
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function attachToCompose(composeWindow) {
    // Find the send button
    const sendBtn = composeWindow.querySelector(
      'div[role="button"][aria-label*="Send"], div[role="button"][data-tooltip*="Send"]'
    );
    if (!sendBtn) return;

    sendBtn.addEventListener(
      "click",
      () => {
        const trackingId = generateId();

        // Get recipient and subject from compose window
        const recipientEl = composeWindow.querySelector(
          'span[email], input[aria-label="To"]'
        );
        const subjectEl = composeWindow.querySelector(
          'input[name="subjectbox"]'
        );
        const recipient = recipientEl
          ? recipientEl.getAttribute("email") || recipientEl.value || "unknown"
          : "unknown";
        const subject = subjectEl ? subjectEl.value || "(no subject)" : "(no subject)";

        // Inject tracking pixel into the email body
        const body = composeWindow.querySelector(
          'div[role="textbox"][aria-label*="Body"], div[aria-label*="Message Body"], div.editable'
        );
        if (body) {
          const pixel = document.createElement("img");
          pixel.src = `${SERVER_URL}/track?id=${trackingId}`;
          pixel.width = 1;
          pixel.height = 1;
          pixel.style.cssText =
            "display:block!important;width:1px!important;height:1px!important;opacity:0.01;position:absolute;";
          body.appendChild(pixel);
        }

        // Save tracking data
        chrome.runtime.sendMessage({
          type: "TRACK_SEND",
          data: {
            trackingId,
            recipient,
            subject,
            timestamp: new Date().toISOString(),
          },
        });

        // Store mapping for UI display
        saveTrackingMapping(trackingId, recipient, subject);
      },
      true
    );
  }

  // ===== OPEN STATUS DISPLAY IN GMAIL =====

  // Add checkmarks to sent emails in the email list
  async function updateSentMailStatus() {
    const mappings = await getTrackingMappings();
    if (Object.keys(mappings).length === 0) return;

    // Find email rows in the sent folder
    const rows = document.querySelectorAll("tr.zA");
    for (const row of rows) {
      if (row.dataset.trackerChecked) continue;

      const subjectEl = row.querySelector(".y6 span[data-thread-id], .bog");
      const recipientEl = row.querySelector(".yW span[email], .yW .bA4");
      if (!subjectEl) continue;

      const subject = subjectEl.textContent.trim();
      const recipient = recipientEl
        ? recipientEl.getAttribute("email") ||
          recipientEl.getAttribute("name") ||
          ""
        : "";

      // Find matching tracking entry
      const match = Object.entries(mappings).find(
        ([, data]) =>
          data.subject === subject ||
          (data.recipient === recipient && data.subject === subject)
      );

      if (match) {
        const [trackingId] = match;
        row.dataset.trackerChecked = "true";
        row.dataset.trackingId = trackingId;

        // Check open status from server
        fetchOpenStatus(trackingId).then((status) => {
          addStatusBadge(row, status);
        });
      }
    }
  }

  function addStatusBadge(row, status) {
    // Remove existing badge
    const existing = row.querySelector(".email-tracker-badge");
    if (existing) existing.remove();

    const badge = document.createElement("span");
    badge.className = "email-tracker-badge";

    if (status.openCount > 0) {
      badge.textContent = `${CHECKMARK_READ} ${status.openCount}x`;
      badge.classList.add("email-tracker-read");
      badge.title = `Opened ${status.openCount} time(s)\nLast: ${status.lastOpen || "unknown"}`;
    } else {
      badge.textContent = CHECKMARK_SENT;
      badge.classList.add("email-tracker-sent");
      badge.title = "Sent — not opened yet";
    }

    // Insert badge near the date/time area
    const dateCell = row.querySelector(".xW, .bq3");
    if (dateCell) {
      dateCell.style.position = "relative";
      dateCell.insertBefore(badge, dateCell.firstChild);
    }
  }

  // Also show status when viewing an individual sent email
  function updateOpenEmailStatus() {
    const subjectEl = document.querySelector("h2.hP");
    if (!subjectEl) return;

    // Check if we already added a banner
    if (document.querySelector(".email-tracker-banner")) return;

    const subject = subjectEl.textContent.trim();

    getTrackingMappings().then(async (mappings) => {
      const match = Object.entries(mappings).find(
        ([, data]) => data.subject === subject
      );
      if (!match) return;

      const [trackingId, data] = match;
      const status = await fetchOpenStatus(trackingId);

      const banner = document.createElement("div");
      banner.className = "email-tracker-banner";

      if (status.openCount > 0) {
        banner.innerHTML = `
          <span class="email-tracker-banner-icon">&#128065;</span>
          <strong>${data.recipient}</strong> opened this email
          <strong>${status.openCount}</strong> time(s).
          Last opened: <strong>${formatDate(status.lastOpen)}</strong>
        `;
        banner.classList.add("email-tracker-banner-read");
      } else {
        banner.innerHTML = `
          <span class="email-tracker-banner-icon">&#9993;</span>
          Sent to <strong>${data.recipient}</strong> — not opened yet.
        `;
        banner.classList.add("email-tracker-banner-sent");
      }

      // Insert banner above the email
      const emailContainer =
        subjectEl.closest(".nH") || subjectEl.parentElement;
      emailContainer.insertBefore(banner, subjectEl.nextSibling);
    });
  }

  // ===== HELPERS =====

  function generateId() {
    return "et_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  async function fetchOpenStatus(trackingId) {
    try {
      const resp = await fetch(`${SERVER_URL}/opens?id=${trackingId}`);
      const data = await resp.json();
      return {
        openCount: data.openCount || 0,
        lastOpen:
          data.opens && data.opens.length
            ? data.opens[data.opens.length - 1].timestamp
            : null,
        opens: data.opens || [],
      };
    } catch {
      return { openCount: 0, lastOpen: null, opens: [] };
    }
  }

  function formatDate(isoString) {
    if (!isoString) return "unknown";
    const d = new Date(isoString);
    return d.toLocaleString();
  }

  async function saveTrackingMapping(trackingId, recipient, subject) {
    const result = await chrome.storage.local.get("tracking_mappings");
    const mappings = result.tracking_mappings || {};
    mappings[trackingId] = { recipient, subject, sentAt: new Date().toISOString() };

    // Keep only last 500 entries
    const entries = Object.entries(mappings);
    if (entries.length > 500) {
      const trimmed = Object.fromEntries(entries.slice(-500));
      await chrome.storage.local.set({ tracking_mappings: trimmed });
    } else {
      await chrome.storage.local.set({ tracking_mappings: mappings });
    }
  }

  async function getTrackingMappings() {
    const result = await chrome.storage.local.get("tracking_mappings");
    return result.tracking_mappings || {};
  }

  // ===== INIT =====

  function init() {
    observeSendButton();

    // Periodically update status in sent mail view
    setInterval(() => {
      updateSentMailStatus();
      updateOpenEmailStatus();
    }, POLL_INTERVAL);

    // Also run on URL changes (Gmail is a SPA)
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
          updateSentMailStatus();
          updateOpenEmailStatus();
        }, 1500);
      }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });

    // Initial run
    setTimeout(() => {
      updateSentMailStatus();
      updateOpenEmailStatus();
    }, 3000);
  }

  init();
})();
