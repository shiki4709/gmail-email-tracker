// Content script - runs inside Gmail
// Auto-injects tracking pixel when you click Send

(function () {
  "use strict";

  let SERVER_URL = "http://localhost:3100";

  chrome.storage.local.get("server_url", (result) => {
    if (result.server_url) SERVER_URL = result.server_url;
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.server_url) SERVER_URL = changes.server_url.newValue;
  });

  const POLL_INTERVAL = 30000;

  // ===== ATTACH TO SEND BUTTONS =====

  function scanForSendButtons() {
    const allButtons = document.querySelectorAll('[role="button"]');

    allButtons.forEach((btn) => {
      if (btn.dataset.etAttached) return;

      const text = btn.textContent.trim();
      const label = (btn.getAttribute("aria-label") || "") + " " + (btn.getAttribute("data-tooltip") || "");

      const isSend = /^Send$/i.test(text) || /^送信$/i.test(text) ||
                     /^Send mail/i.test(label) || /送信/i.test(label) ||
                     /^Send /.test(text);

      if (!isSend) return;
      btn.dataset.etAttached = "true";

      console.log("[Email Tracker] Attached to Send button:", text, label);

      btn.addEventListener("click", () => {
        console.log("[Email Tracker] Send clicked — injecting pixel");
        autoInjectFromSendButton(btn);
      }, true);
    });
  }

  function autoInjectFromSendButton(sendBtn) {
    // Walk up from send button to find compose container
    // Try progressively larger parent containers
    let container = sendBtn.parentElement;
    let body = null;
    let depth = 0;

    while (container && depth < 20) {
      body = container.querySelector(
        'div[role="textbox"][contenteditable="true"], div[g_editable="true"][contenteditable="true"], div.editable[contenteditable="true"], div[contenteditable="true"][aria-multiline="true"]'
      );
      if (body) break;
      container = container.parentElement;
      depth++;
    }

    if (!body) {
      // Last resort: any contenteditable on the page
      const all = document.querySelectorAll('div[contenteditable="true"]');
      body = all.length ? all[all.length - 1] : null;
    }

    if (!body) {
      console.log("[Email Tracker] Could not find compose body");
      return;
    }

    if (body.dataset.pixelInjected) {
      console.log("[Email Tracker] Already injected in this compose");
      return;
    }

    body.dataset.pixelInjected = "true";

    // === FIND RECIPIENT ===
    let recipient = "unknown";

    // Log everything we can see to help debug
    console.log("[Email Tracker] Compose container depth:", depth);
    console.log("[Email Tracker] Container tag:", container.tagName, container.className.slice(0, 80));

    // Search the compose container for email addresses
    if (container) {
      // Dump all elements with potentially useful attributes
      const candidates = container.querySelectorAll("span[email], [data-hovercard-id], [data-name], input[type='hidden']");
      candidates.forEach(el => {
        console.log("[Email Tracker] Candidate:", el.tagName, {
          email: el.getAttribute("email"),
          hovercard: el.getAttribute("data-hovercard-id"),
          name: el.getAttribute("data-name"),
          text: el.textContent.slice(0, 50),
        });
      });

      // Strategy 1: span[email]
      const emailSpans = container.querySelectorAll("span[email]");
      if (emailSpans.length) {
        recipient = Array.from(emailSpans)
          .map(el => el.getAttribute("email"))
          .filter(Boolean)
          .join(", ");
      }

      // Strategy 2: data-hovercard-id with @
      if (recipient === "unknown") {
        const hovercards = container.querySelectorAll("[data-hovercard-id]");
        const emails = Array.from(hovercards)
          .map(el => el.getAttribute("data-hovercard-id"))
          .filter(e => e && e.includes("@"));
        if (emails.length) recipient = emails.join(", ");
      }

      // Strategy 3: look for email pattern in any element's attributes
      if (recipient === "unknown") {
        const allEls = container.querySelectorAll("*");
        for (const el of allEls) {
          for (const attr of el.attributes) {
            const match = attr.value.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
            if (match) {
              recipient = match[0];
              console.log("[Email Tracker] Found email in attr:", attr.name, "=", attr.value);
              break;
            }
          }
          if (recipient !== "unknown") break;
        }
      }

      // Strategy 4: regex on visible text in To area
      if (recipient === "unknown") {
        const toAreas = container.querySelectorAll('[aria-label*="To"], [aria-label*="宛先"], [data-tooltip*="To"]');
        for (const area of toAreas) {
          const match = area.textContent.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
          if (match) {
            recipient = match[0];
            break;
          }
        }
      }
    }

    // Strategy 5: search entire page for span[email] and pick the ones not matching our own email
    if (recipient === "unknown") {
      const allEmailSpans = document.querySelectorAll("span[email]");
      const emails = Array.from(allEmailSpans)
        .map(el => el.getAttribute("email"))
        .filter(Boolean);
      console.log("[Email Tracker] All span[email] on page:", emails);
      if (emails.length) {
        recipient = emails[emails.length - 1];
      }
    }

    // === FIND SUBJECT ===
    let subject = "(no subject)";

    if (container) {
      const subjEl = container.querySelector('input[name="subjectbox"]');
      if (subjEl && subjEl.value) subject = subjEl.value;
    }
    if (subject === "(no subject)") {
      const threadHeader = document.querySelector("h2.hP");
      if (threadHeader) subject = threadHeader.textContent.trim();
    }
    if (subject === "(no subject)") {
      const title = document.title.replace(/ - .*$/, "").trim();
      if (title && !/Gmail|Inbox|受信/.test(title)) subject = title;
    }

    // === INJECT PIXEL ===
    const trackingId = "et_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

    const pixel = document.createElement("img");
    pixel.src = `${SERVER_URL}/track?id=${trackingId}`;
    pixel.width = 1;
    pixel.height = 1;
    pixel.style.cssText = "opacity:0.01;width:1px;height:1px;position:absolute;";
    body.appendChild(pixel);

    console.log(`[Email Tracker] ✅ TRACKED: ${trackingId} | To: ${recipient} | Subject: ${subject}`);

    // Register with server
    fetch(`${SERVER_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingId, recipient, subject: subject.trim() }),
    }).catch(() => {});

    // Save locally
    chrome.runtime.sendMessage({
      type: "TRACK_SEND",
      data: { trackingId, recipient, subject: subject.trim(), timestamp: new Date().toISOString() },
    });
    saveTrackingMapping(trackingId, recipient, subject.trim());
  }

  // ===== DISPLAY STATUS IN GMAIL =====

  async function updateSentMailStatus() {
    const mappings = await getTrackingMappings();
    if (Object.keys(mappings).length === 0) return;

    const rows = document.querySelectorAll("tr.zA");
    for (const row of rows) {
      const lastCheck = parseInt(row.dataset.trackerLastCheck || "0");
      if (Date.now() - lastCheck < POLL_INTERVAL) continue;
      row.dataset.trackerLastCheck = Date.now().toString();

      const subjectEl = row.querySelector(".bog, .bqe, .y6 span");
      if (!subjectEl) continue;

      const subject = subjectEl.textContent.trim();
      const cleanSubject = subject.replace(/^(Re|Fwd|Fw):\s*/i, "");

      const match = Object.entries(mappings).find(([, data]) => {
        const cleanData = data.subject.replace(/^(Re|Fwd|Fw):\s*/i, "");
        return cleanData === cleanSubject || data.subject === subject;
      });

      if (match) {
        const [trackingId] = match;
        fetchOpenStatus(trackingId).then((status) => {
          addStatusBadge(row, status);
        });
      }
    }
  }

  function addStatusBadge(row, status) {
    const existing = row.querySelector(".email-tracker-badge");
    if (existing) existing.remove();

    const badge = document.createElement("span");
    badge.className = "email-tracker-badge";

    if (status.openCount > 0) {
      badge.textContent = `\u2713\u2713 ${status.openCount}x`;
      badge.classList.add("email-tracker-read");
      badge.title = `Opened ${status.openCount} time(s)\nLast: ${status.lastOpen || "unknown"}`;
    } else {
      badge.textContent = "\u2713";
      badge.classList.add("email-tracker-sent");
      badge.title = "Sent \u2014 not opened yet";
    }

    const dateCell = row.querySelector(".xW, .bq3, td:last-child");
    if (dateCell) {
      dateCell.insertBefore(badge, dateCell.firstChild);
    }
  }

  function updateOpenEmailStatus() {
    const subjectEl = document.querySelector("h2.hP");
    if (!subjectEl) return;
    if (document.querySelector(".email-tracker-banner")) return;

    const subject = subjectEl.textContent.trim();
    const cleanSubject = subject.replace(/^(Re|Fwd|Fw):\s*/i, "");

    getTrackingMappings().then(async (mappings) => {
      const match = Object.entries(mappings).find(([, data]) => {
        const cleanData = data.subject.replace(/^(Re|Fwd|Fw):\s*/i, "");
        return cleanData === cleanSubject || data.subject === subject;
      });
      if (!match) return;

      const [trackingId, data] = match;
      const status = await fetchOpenStatus(trackingId);

      const banner = document.createElement("div");
      banner.className = "email-tracker-banner";

      if (status.openCount > 0) {
        banner.innerHTML = `
          <span class="email-tracker-banner-icon">&#128065;</span>
          <strong>${escapeHtml(data.recipient)}</strong> opened this email
          <strong>${status.openCount}</strong> time(s).
          Last opened: <strong>${formatDate(status.lastOpen)}</strong>
        `;
        banner.classList.add("email-tracker-banner-read");
      } else {
        banner.innerHTML = `
          <span class="email-tracker-banner-icon">&#9993;</span>
          Sent to <strong>${escapeHtml(data.recipient)}</strong> \u2014 not opened yet.
        `;
        banner.classList.add("email-tracker-banner-sent");
      }

      const ctr = subjectEl.closest(".nH") || subjectEl.parentElement;
      ctr.insertBefore(banner, subjectEl.nextSibling);
    });
  }

  // ===== HELPERS =====

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function fetchOpenStatus(trackingId) {
    try {
      const resp = await fetch(`${SERVER_URL}/opens?id=${trackingId}`);
      const data = await resp.json();
      return {
        openCount: data.openCount || 0,
        lastOpen: data.opens?.length ? data.opens[data.opens.length - 1].timestamp : null,
      };
    } catch {
      return { openCount: 0, lastOpen: null };
    }
  }

  function formatDate(isoString) {
    if (!isoString) return "unknown";
    return new Date(isoString).toLocaleString();
  }

  async function saveTrackingMapping(trackingId, recipient, subject) {
    const result = await chrome.storage.local.get("tracking_mappings");
    const mappings = result.tracking_mappings || {};
    mappings[trackingId] = { recipient, subject, sentAt: new Date().toISOString() };
    const entries = Object.entries(mappings);
    const final = entries.length > 500 ? Object.fromEntries(entries.slice(-500)) : mappings;
    await chrome.storage.local.set({ tracking_mappings: final });
  }

  async function getTrackingMappings() {
    const result = await chrome.storage.local.get("tracking_mappings");
    return result.tracking_mappings || {};
  }

  // ===== INIT =====

  console.log("[Email Tracker] Content script loaded");

  setInterval(scanForSendButtons, 2000);

  setInterval(() => {
    updateSentMailStatus();
    updateOpenEmailStatus();
  }, POLL_INTERVAL);

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        updateSentMailStatus();
        updateOpenEmailStatus();
      }, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    updateSentMailStatus();
    updateOpenEmailStatus();
  }, 3000);
})();
