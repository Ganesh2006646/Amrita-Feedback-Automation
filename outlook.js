// outlook.js - Content script for Outlook Web (reads OTP from email)

(function () {
  "use strict";

  if (window.__amrita_outlook_loaded) return;
  window.__amrita_outlook_loaded = true;

  console.log("[Amrita Outlook] Loaded on:", window.location.href);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GET_LATEST_OTP") {
      console.log("[Amrita Outlook] GET_LATEST_OTP, last:", message.lastOtp || "none");
      pollForOtp(message.lastOtp || "")
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // async
    }
  });

  // Extract OTP from email body text
  function extractOtp(text) {
    if (!text) return null;

    // "OTP for Student Feedback Verification is sH6PB"
    const m1 = text.match(/OTP for Student (?:Feedback )?Verification is\s+([A-Za-z0-9]{4,8})/i);
    if (m1) return m1[1].trim();

    const m2 = text.match(/Feedback Verification is\s+([A-Za-z0-9]{4,8})/i);
    if (m2) return m2[1].trim();

    const m3 = text.match(/Verification is\s+([A-Za-z0-9]{4,8})/i);
    if (m3) return m3[1].trim();

    return null;
  }

  // Click the latest OTP email in Outlook inbox
  function clickLatestOtpEmail() {
    // Strategy 1: Find email list items containing "Amrita Vishwa" or "OTP for Student Portal"
    const listItems = document.querySelectorAll(
      'div[role="option"], div[role="listitem"], [data-convid], tr[aria-label]'
    );

    let matches = [];
    for (const el of listItems) {
      const txt = (el.innerText || el.textContent || "").toLowerCase();
      if (txt.includes("amrita vishwa") || txt.includes("otp for student portal") || txt.includes("student feedback")) {
        matches.push(el);
      }
    }

    // Strategy 2: Search for visible spans/divs with matching text
    if (matches.length === 0) {
      const candidates = document.querySelectorAll("div, span");
      for (const el of candidates) {
        const txt = (el.textContent || "");
        if ((txt.includes("OTP for Student Portal") || txt.includes("Amrita Vishwa Vidyapeetham")) &&
            txt.length < 300 && el.offsetParent !== null) {
          matches.push(el);
        }
      }
    }

    if (matches.length > 0) {
      // Sort by vertical position — top is newest
      matches.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

      // Find the clickable parent (list item)
      const target = matches[0].closest('div[role="option"], div[role="listitem"], [data-convid]') || matches[0];

      console.log("[Amrita Outlook] Clicking email:", target.textContent.slice(0, 80));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      target.click();
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      return true;
    }

    return false;
  }

  // Refresh inbox by clicking the Inbox folder
  function refreshInbox() {
    try {
      const spans = document.querySelectorAll("span, div, a");
      for (const el of spans) {
        if (el.textContent.trim().toLowerCase() === "inbox" && el.offsetParent !== null) {
          el.click();
          break;
        }
      }
    } catch (e) {}
  }

  // Poll for new OTP email
  async function pollForOtp(lastOtp) {
    const maxAttempts = 35;
    const interval = 1500;

    console.log("[Amrita Outlook] Polling... old OTP:", lastOtp);

    for (let i = 1; i <= maxAttempts; i++) {
      console.log("[Amrita Outlook] Attempt", i + "/" + maxAttempts);

      // Click the latest feedback email
      clickLatestOtpEmail();

      // Wait for reading pane
      await new Promise(r => setTimeout(r, 700));

      // Search for OTP in visible text
      const bodyText = document.body.innerText || "";
      const otp = extractOtp(bodyText);

      console.log("[Amrita Outlook] Detected OTP:", otp);

      if (otp && otp !== lastOtp) {
        console.log("[Amrita Outlook] Fresh OTP found:", otp);
        return { success: true, otp: otp };
      }

      // Refresh inbox every 4 attempts
      if (i % 4 === 0) {
        refreshInbox();
      }

      await new Promise(r => setTimeout(r, interval));
    }

    // Final try: return any OTP found
    const finalOtp = extractOtp(document.body.innerText || "");
    if (finalOtp) {
      return { success: true, otp: finalOtp };
    }

    return {
      success: false,
      error: "Timeout: OTP email not found in Outlook."
    };
  }
})();
