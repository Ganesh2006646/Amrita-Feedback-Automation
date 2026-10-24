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

    const feedbackTab = tabs.find(t => t.id === feedbackTabId);
    const isStudentPortalTab = tab => {
      try {
        return Boolean(tab && tab.id !== feedbackTabId && tab.url &&
          new URL(tab.url).hostname === "students.amrita.edu");
      } catch (_) {
        return false;
      }
    };
    const isTargetListTab = tab => {
      if (!isStudentPortalTab(tab)) return false;
      try {
        const url = new URL(tab.url);
        if (url.hostname !== "students.amrita.edu") return false;
        if (listPattern === "class-feedback") {
          // Forms can also use /class-feedback, but always carry form identifiers.
          return url.pathname.includes("/client/class-feedback") &&
            !url.searchParams.has("cid") && !url.searchParams.has("fid");
        }
        return url.pathname.includes("/client/course-feedback-list");
      } catch (_) {
        return false;
      }
    };

    // Prefer the tab that opened the feedback form, then an already-open matching list.
    let portalTab = feedbackTab && typeof feedbackTab.openerTabId === "number"
      ? tabs.find(t => t.id === feedbackTab.openerTabId && isTargetListTab(t))
      : null;
    if (!portalTab) portalTab = tabs.find(isTargetListTab);
    // A list tab may have navigated elsewhere while the form was open. It is still
    // the best place to return before navigating it back to the feedback list.
    if (!portalTab && feedbackTab && typeof feedbackTab.openerTabId === "number") {
      portalTab = tabs.find(t => t.id === feedbackTab.openerTabId && isStudentPortalTab(t));
    }
    if (!portalTab) portalTab = tabs.find(isStudentPortalTab);

    if (portalTab && feedbackTabId) {
      console.log("[Amrita BG] Closing feedback tab", feedbackTabId, "and returning to list tab", portalTab.id);
      try {
        await chrome.tabs.remove(feedbackTabId);
      } catch (e) {
        console.warn("[Amrita BG] Could not close feedback tab:", e.message);
      }

      await chrome.tabs.update(portalTab.id, { active: true });
      // Allow the submission response to settle before fetching the updated pending list.
      await new Promise(r => setTimeout(r, 800));
      const currentUrl = (portalTab.url || "").toLowerCase();
      if (isTargetListTab(portalTab) && currentUrl.startsWith(targetUrl)) {
        await chrome.tabs.reload(portalTab.id);
      } else {
        await chrome.tabs.update(portalTab.id, { url: targetUrl });
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
