// This script runs in the PAGE context (not extension context)
// It intercepts Gmail's XHR to detect email sends

(function() {
  "use strict";

  // Notify content script when a send is detected
  function notifySend() {
    window.dispatchEvent(new CustomEvent("__email_tracker_send__"));
  }

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    // Gmail uses these URL patterns when sending
    if (url.includes("/mail/u/") && (url.includes("&act=sm&") || url.includes("?act=sm&") || url.includes("sm?"))) {
      notifySend();
    }
    return origFetch.apply(this, args);
  };

  // Intercept XHR
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === "string" && url.includes("/mail/u/") && (url.includes("&act=sm") || url.includes("?act=sm"))) {
      this.__isSend = true;
    }
    return origOpen.call(this, method, url, ...rest);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    if (this.__isSend) {
      notifySend();
    }
    return origSend.apply(this, args);
  };
})();
