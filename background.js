// background.js - Service Worker for Amrita Feedback Automator

console.log("[Amrita BG] Service worker initialized.");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "FETCH_OTP") {
    handleFetchOtp(message.lastOtp, sendResponse);
    return true; // async
  }

  if (message.action === "CLOSE_AND_REFRESH_PORTAL") {
    handleCloseAndRefresh(
      sender.tab ? sender.tab.id : null,
      message.origin || "",
      sendResponse
    );
    return true; // async
  }
});

// Find the Outlook tab
async function findOutlookTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find(t => {
    const url = (t.url || "").toLowerCase();
    const title = (t.title || "").toLowerCase();
    return (
      url.includes("cloud.microsoft") ||
      url.includes("outlook.office.com") ||
      url.includes("outlook.office365.com") ||
      url.includes("outlook.live.com") ||
      (title.includes("outlook") && (url.includes("office") || url.includes("microsoft") || url.includes("live.com")))
    );
  });
}

async function handleFetchOtp(lastOtp, sendResponse) {
  try {
    const outlookTab = await findOutlookTab();
    if (!outlookTab) {
      sendResponse({
        success: false,
        error: "Outlook tab not found! Open Outlook in another tab."
      });
      return;
    }

    console.log("[Amrita BG] Outlook tab:", outlookTab.id, outlookTab.url);

    // Inject outlook.js (if not already loaded)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: outlookTab.id },
        files: ["outlook.js"]
      });
    } catch (e) {
      console.warn("[Amrita BG] Injection note:", e.message);
    }

    // Small delay for injection
    await new Promise(r => setTimeout(r, 500));

    // Ask outlook.js to extract OTP
    chrome.tabs.sendMessage(
      outlookTab.id,
      { action: "GET_LATEST_OTP", lastOtp: lastOtp },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Amrita BG] Msg error:", chrome.runtime.lastError.message);
          sendResponse({
            success: false,
            error: "Cannot reach Outlook tab: " + chrome.runtime.lastError.message
          });
        } else {
          sendResponse(response || { success: false, error: "No response from Outlook tab" });
        }
      }
    );
  } catch (err) {
    console.error("[Amrita BG] fetchOtp error:", err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleCloseAndRefresh(feedbackTabId, origin, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({});
    const listPattern = (origin || "").toLowerCase();

    const targetUrl = listPattern === "class-feedback"
      ? "https://students.amrita.edu/client/class-feedback"
      : "https://students.amrita.edu/client/course-feedback-list";

    // 1. Find the portal list tab
    let portalTab = tabs.find(t => {
      if (t.id === feedbackTabId) return false;
      if (!t.url) return false;
      const url = t.url.toLowerCase();

      if (listPattern && url.includes(listPattern)) return true;
      return url.includes("course-feedback-list") || url.includes("class-feedback") || url.includes("feedback-list");
    });

    // Fallback: any other student portal tab
    if (!portalTab) {
      portalTab = tabs.find(t => t.id !== feedbackTabId && t.url && t.url.toLowerCase().includes("students.amrita.edu"));
    }

    if (portalTab && feedbackTabId) {
      console.log("[Amrita BG] Switching to portal tab", portalTab.id, "and closing tab", feedbackTabId);
      await chrome.tabs.update(portalTab.id, { active: true });

      // Refresh list page or navigate to it
      const currentUrl = (portalTab.url || "").toLowerCase();
      if (currentUrl.includes("course-feedback-list") || currentUrl.includes("class-feedback")) {
        await chrome.tabs.reload(portalTab.id);
      } else {
        await chrome.tabs.update(portalTab.id, { url: targetUrl });
      }

      await new Promise(r => setTimeout(r, 800));
      try {
        await chrome.tabs.remove(feedbackTabId);
      } catch (e) {
        console.warn("[Amrita BG] Could not close feedback tab:", e.message);
      }
    } else if (feedbackTabId) {
      // Single-tab mode: navigate directly to list page
      console.log("[Amrita BG] Single tab mode → navigating to", targetUrl);
      await chrome.tabs.update(feedbackTabId, { url: targetUrl });
    }

    sendResponse({ success: true });
  } catch (err) {
    console.error("[Amrita BG] closeAndRefresh error:", err);
    sendResponse({ success: false, error: err.message });
  }
}
