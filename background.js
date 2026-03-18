// Background service worker - manages tracking data

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRACK_SEND") {
    handleTrackSend(message.data).then(sendResponse);
    return true;
  }
  if (message.type === "GET_ALL_TRACKING") {
    getAllTracking().then(sendResponse);
    return true;
  }
  if (message.type === "GET_TRACKING") {
    getTracking(message.trackingId).then(sendResponse);
    return true;
  }
});

async function handleTrackSend(data) {
  const { trackingId, recipient, subject, timestamp } = data;
  const result = await chrome.storage.local.get("tracked_emails");
  const tracked = result.tracked_emails || {};
  tracked[trackingId] = {
    recipient,
    subject,
    sentAt: timestamp,
    opens: [],
    openCount: 0,
  };
  await chrome.storage.local.set({ tracked_emails: tracked });
  return { success: true };
}

async function getAllTracking() {
  const result = await chrome.storage.local.get("tracked_emails");
  return result.tracked_emails || {};
}

async function getTracking(trackingId) {
  const result = await chrome.storage.local.get("tracked_emails");
  const tracked = result.tracked_emails || {};
  return tracked[trackingId] || null;
}
