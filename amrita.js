// amrita.js - Full automation for Amrita Student Portal Feedback
// Supports BOTH: Class TLP Feedback and Course Feedback with full OTP & Finish loop

(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════
  // GUARD: Only one instance per page load. On SPA navigation
  // the guard is cleared so the script re-initialises.
  // ══════════════════════════════════════════════════════════
  if (window.__amrita_automator_running) return;
  window.__amrita_automator_running = true;

  console.log("[Amrita Automator] Injected on:", window.location.href);

  // ──────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────
  let isRunning = localStorage.getItem("amrita_auto_running") === "true";
  let lastUsedOtp = localStorage.getItem("amrita_last_otp") || "";
  let originListPage = localStorage.getItem("amrita_origin_list") || "";
  // Prevent double close/navigate per course cycle.
  let isReturningToList = false;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ══════════════════════════════════════════════════════════
  // PAGE TYPE DETECTION
  // ══════════════════════════════════════════════════════════
  function getPageType() {
    const path = window.location.pathname.toLowerCase();
    const href = window.location.href.toLowerCase();

    if (path.includes("course-feedback-list")) return "LIST_PAGE";
    if (path.includes("class-feedback") && !href.includes("cid=") && !href.includes("fid=")) return "LIST_PAGE";

    if (path.includes("feedback") || href.includes("cid=") || href.includes("fid=")) return "FORM_PAGE";

    return "UNKNOWN";
  }

  const pageType = getPageType();
  console.log("[Amrita] Page type:", pageType);

  // Track origin list page
  const currentPath = window.location.pathname.toLowerCase();
  if (currentPath.includes("course-feedback-list")) {
    originListPage = "course-feedback-list";
    localStorage.setItem("amrita_origin_list", "course-feedback-list");
  } else if (currentPath.includes("class-feedback")) {
    originListPage = "class-feedback";
    localStorage.setItem("amrita_origin_list", "class-feedback");
  }

  // Build widget
  createWidget();

  // Auto-resume if flag is set
  if (isRunning && pageType !== "UNKNOWN") {
    updateBadge("RUNNING", "running");
    log("Auto-resuming feedback automation...");
    setTimeout(() => runNextStep(), 1200);
  }

  // ══════════════════════════════════════════════════════════
  // REOPEN WIDGET on extension icon click (background sends this)
  // ══════════════════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "REOPEN_WIDGET") {
      // If widget was removed from DOM, recreate it
      if (!document.getElementById("amrita-automator-widget")) {
        createWidget();
        log("Widget reopened. Click 'Start' to begin.");
      }
    }
  });

  // ══════════════════════════════════════════════════════════
  // SPA NAVIGATION WATCHER
  // Amrita portal uses Angular/SPA routing — re-init on URL change
  // ══════════════════════════════════════════════════════════
  let _lastHref = window.location.href;
  const _spaObserver = new MutationObserver(() => {
    if (window.location.href !== _lastHref) {
      _lastHref = window.location.href;
      onSpaNavigate();
    }
  });
  _spaObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

  window.addEventListener("popstate", onSpaNavigate);
  window.addEventListener("hashchange", onSpaNavigate);

  function onSpaNavigate() {
    console.log("[Amrita] SPA navigation detected →", window.location.href);
    // Allow a brief moment for the new page DOM to render
    setTimeout(() => {
      // Re-track origin
      const p = window.location.pathname.toLowerCase();
      if (p.includes("course-feedback-list")) {
        originListPage = "course-feedback-list";
        localStorage.setItem("amrita_origin_list", "course-feedback-list");
      } else if (p.includes("class-feedback") && !window.location.href.toLowerCase().includes("cid=") && !window.location.href.toLowerCase().includes("fid=")) {
        originListPage = "class-feedback";
        localStorage.setItem("amrita_origin_list", "class-feedback");
      }
      // Recreate widget if it was removed
      if (!document.getElementById("amrita-automator-widget")) {
        createWidget();
      }
      // Resume if running
      if (isRunning && getPageType() !== "UNKNOWN") {
        isReturningToList = false;
        updateBadge("RUNNING", "running");
        log("Resuming after navigation...");
        runNextStep();
      }
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════
  // MAIN FLOW CONTROLLER
  // ══════════════════════════════════════════════════════════
  async function runNextStep() {
    if (!isRunning) return;
    isReturningToList = false; // Reset guard at start of every cycle step

    const pt = getPageType();
    if (pt === "LIST_PAGE") {
      await handleListPage();
    } else if (pt === "FORM_PAGE") {
      await handleFeedbackForm();
    } else {
      log("Navigate to Course Feedback or Class Feedback to begin.");
      updateBadge("IDLE", "idle");
      stopAutomation();
    }
  }

  // ══════════════════════════════════════════════════════════
  // 1. LIST PAGE: SCAN & OPEN NEXT COURSE
  // ══════════════════════════════════════════════════════════
  async function handleListPage() {
    log("Scanning courses for pending feedback...");
    updateBadge("SCANNING", "running");

    let submitBtn = null;
    let courseName = "";

    for (let attempt = 0; attempt < 30; attempt++) {
      if (!isRunning) return;

      // Search table rows first
      const rows = document.querySelectorAll("table tbody tr, table tr");
      for (const row of rows) {
        const text = (row.innerText || "").toLowerCase();
        if (text.includes("completed") || text.includes("view feedback")) continue;

        const btns = row.querySelectorAll("button, a, input[type='button'], input[type='submit']");
        for (const b of btns) {
          const t = (b.textContent || b.value || "").trim();
          if (/submit\s*feedback/i.test(t) && isVisible(b)) {
            submitBtn = b;
            const cells = row.querySelectorAll("td");
            courseName = cells.length >= 2 ? cells[1].innerText.trim() : "Course";
            break;
          }
        }
        if (submitBtn) break;
      }

      // Broad search if not found in table
      if (!submitBtn) {
        const allBtns = document.querySelectorAll("button, a, input[type='button'], input[type='submit']");
        for (const b of allBtns) {
          if (b.closest("#amrita-automator-widget")) continue;
          const t = (b.textContent || b.value || "").trim();
          if (/submit\s*feedback/i.test(t) && !/view\s*feedback/i.test(t) && isVisible(b)) {
            submitBtn = b;
            break;
          }
        }
      }

      if (submitBtn) break;
      await sleep(500);
    }

    if (submitBtn) {
      log(`Found pending course: "${courseName.slice(0, 35)}". Opening...`);
      updateBadge("OPENING", "running");
      await sleep(400);

      // Record URL before click to detect navigation or popup
      const urlBefore = window.location.href;
      submitBtn.click();

      // Wait up to 5 s for navigation to happen
      let navigated = false;
      for (let w = 0; w < 20; w++) {
        await sleep(250);
        if (window.location.href !== urlBefore) { navigated = true; break; }
      }

      if (!navigated) {
        // SPA may have loaded the form in-place — try checking page type
        await sleep(500);
        if (getPageType() === "FORM_PAGE") {
          isReturningToList = false;
          await handleFeedbackForm();
        } else {
          log("⚠ Page did not navigate after button click. Retrying...");
          await sleep(1500);
          if (isRunning) handleListPage();
        }
      }
      // If navigated, the content script re-runs (full reload) or onSpaNavigate fires (SPA)
    } else {
      log("🎉 All courses completed! Great job!");
      updateBadge("ALL DONE", "completed");
      stopAutomation();
    }
  }

  // ══════════════════════════════════════════════════════════
  // 2. FORM PAGE: UNIFIED HANDLER
  //    Priority: OTP screen → Finish screen → Questions
  // ══════════════════════════════════════════════════════════
  async function handleFeedbackForm() {
    if (!isRunning) return;

    // OTP takes priority always
    if (isOnOtpScreen()) {
      await handleOtpFlow();
      return;
    }

    if (isFinishScreen()) {
      await handleFinishStep();
      return;
    }

    // Answer questions
    updateBadge("ANSWERING", "running");

    const selected = selectFirstOption();
    if (selected) {
      const stepNum = getCurrentStepNumber();
      log(`Question ${stepNum}: Selected Option 1 ✓`);
      await sleep(500);

      const nextBtn = findSubmitNextButton();
      if (nextBtn) {
        const btnText = (nextBtn.textContent || nextBtn.value || "").trim();
        log(`Clicking '${btnText}'...`);
        await sleep(200);
        nextBtn.click();
        // Page will reload or SPA will advance — both handled
      } else {
        log("⚠ Next/Submit button not found, retrying...");
        await sleep(1500);
        if (isRunning) handleFeedbackForm();
      }
    } else {
      // No radio options — check for other screens
      await sleep(800);
      if (isOnOtpScreen()) {
        await handleOtpFlow();
      } else if (isFinishScreen()) {
        await handleFinishStep();
      } else {
        checkIfDone();
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // 3. FINISH BUTTON & CONFIRMATION DIALOG
  // ══════════════════════════════════════════════════════════
  async function handleFinishStep() {
    log("Finish screen reached! Locating 'Finish' button...");
    updateBadge("FINISHING", "running");

    const finishBtn = findFinishButton();
    if (!finishBtn) {
      log("⚠ Finish button not found, retrying...");
      await sleep(1500);
      if (isRunning) handleFeedbackForm();
      return;
    }

    await sleep(400);
    log("Clicking 'Finish' button...");
    finishBtn.click();

    log("Waiting for confirmation dialog (OK)...");
    await waitForAndClickDialogOk(6000);

    dismissPopups();
    await sleep(1000);
    dismissPopups();

    log("✅ Feedback completed! Closing tab and refreshing portal...");
    updateBadge("DONE", "completed");
    await sleep(1000);

    closeAndRefreshPortal();
  }

  function isFinishScreen() {
    if (isOnOtpScreen()) return false;
    const finishBtn = findFinishButton();
    const hasQuestions = Array.from(document.querySelectorAll(
      "input[name='option_id'], input[type='radio'], label.form-check-label, .custom-radio-card, .option-card"
    )).some(el => !el.closest("#amrita-automator-widget") && isVisible(el));
    return finishBtn !== null && !hasQuestions;
  }

  function findFinishButton() {
    const candidates = document.querySelectorAll("button, a, input[type='submit'], input[type='button'], .btn");
    for (const b of candidates) {
      if (b.closest("#amrita-automator-widget")) continue;
      const txt = (b.textContent || b.value || "").trim().toLowerCase();
      if ((txt === "finish" || /^finish\b/i.test(txt)) && isVisible(b)) return b;
    }
    const byClass = document.querySelector(".finish-btn, #finish-btn, [name='finish']");
    if (byClass && !byClass.closest("#amrita-automator-widget") && isVisible(byClass)) return byClass;
    return null;
  }

  async function waitForAndClickDialogOk(maxWaitMs = 6000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const okBtn = findDialogOkButton();
      if (okBtn) {
        const label = (okBtn.textContent || okBtn.value || "OK").trim();
        log(`Clicking dialog '${label}'...`);
        okBtn.click();
        await sleep(800);

        // Secondary popup (e.g. "Feedback recorded successfully")
        const secondary = findDialogOkButton();
        if (secondary) {
          log("Clicking secondary dialog OK...");
          secondary.click();
          await sleep(600);
        }
        return true;
      }
      await sleep(200);
    }
    return false;
  }

  function findDialogOkButton() {
    // 1. SweetAlert & Bootbox
    const selectors = [
      ".swal2-confirm",
      ".swal2-actions button",
      ".swal-button--confirm",
      ".swal-button",
      ".bootbox-accept",
      "[data-bb-handler='confirm']",
      "[data-bb-handler='ok']"
    ];
    for (const sel of selectors) {
      const b = document.querySelector(sel);
      if (b && !b.closest("#amrita-automator-widget") && isVisible(b)) return b;
    }

    // 2. Buttons inside visible modals/dialogs
    const modals = document.querySelectorAll(
      ".modal.show, .modal[style*='display: block'], [role='dialog'], .swal2-container, .bootbox, .popup, .dialog"
    );
    for (const modal of modals) {
      const buttons = modal.querySelectorAll("button, a, input[type='button'], input[type='submit']");
      for (const b of buttons) {
        if (b.closest("#amrita-automator-widget")) continue;
        if (!isVisible(b)) continue;
        const txt = (b.textContent || b.value || "").trim().toLowerCase();
        if (/^(ok|yes|confirm|proceed|done|close|continue|agree)$/i.test(txt)) return b;
      }
      const primary = modal.querySelector(".btn-primary, .btn-danger, .btn-success");
      if (primary && isVisible(primary)) return primary;
    }

    // 3. Any visible "OK" / "Yes" button anywhere on page
    const allBtns = document.querySelectorAll("button, a, input[type='button'], input[type='submit']");
    for (const b of allBtns) {
      if (b.closest("#amrita-automator-widget")) continue;
      if (!isVisible(b)) continue;
      const txt = (b.textContent || b.value || "").trim().toLowerCase();
      if (txt === "ok" || txt === "yes") return b;
    }

    return null;
  }

  // ══════════════════════════════════════════════════════════
  // 4. OTP HANDLING
  // ══════════════════════════════════════════════════════════
  async function handleOtpFlow() {
    updateBadge("OTP FLOW", "waiting");

    // Click SEND OTP if present
    const sendBtn = findButtonByText(/send\s*otp/i);
    if (sendBtn && isVisible(sendBtn)) {
      log("Clicking 'SEND OTP' button...");
      sendBtn.click();
      await sleep(3000);
    }

    // Wait for OTP input to appear
    let otpInput = findOtpInput();
    if (!otpInput) { await sleep(2000); otpInput = findOtpInput(); }
    if (!otpInput) { await sleep(1500); otpInput = findOtpInput(); }

    log("Requesting latest OTP from Outlook tab...");
    updateBadge("WAITING OTP", "waiting");

    chrome.runtime.sendMessage(
      { action: "FETCH_OTP", lastOtp: lastUsedOtp },
      async (response) => {
        if (!isRunning) return;

        if (chrome.runtime.lastError) {
          log("⚠ Extension error. Enter OTP manually below.");
          updateBadge("MANUAL OTP", "waiting");
          return;
        }

        if (response && response.success && response.otp) {
          const otp = response.otp;
          log(`✅ OTP from Outlook: "${otp}"! Submitting...`);
          lastUsedOtp = otp;
          localStorage.setItem("amrita_last_otp", otp);
          await enterAndValidateOtp(otp);
        } else {
          const err = response ? response.error : "Could not reach Outlook tab";
          log(`⚠ ${err}`);
          log("Enter OTP manually below and click 'Submit OTP'.");
          updateBadge("MANUAL OTP", "waiting");
        }
      }
    );
  }

  async function enterAndValidateOtp(otp) {
    const input = findOtpInput();
    if (!input) {
      log("❌ OTP input field not found!");
      return;
    }

    // Use native setter to bypass React/Angular input interception
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(input, otp);
    } else {
      input.value = otp;
    }
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur",   { bubbles: true }));

    await sleep(600);

    const validateBtn = findButtonByText(/validate/i);
    if (validateBtn && isVisible(validateBtn)) {
      const vText = (validateBtn.textContent || validateBtn.value || "Validate").trim();
      log(`Clicking '${vText}'...`);
      validateBtn.click();
      updateBadge("VALIDATING", "running");

      await sleep(3500);
      await waitForAndClickDialogOk(3000);
      dismissPopups();
      await sleep(1000);

      // Check if OTP screen is still showing (rejected / pending)
      if (isOnOtpScreen()) {
        log("⚠ OTP still pending. Check portal and retry OTP manually.");
        updateBadge("CHECK OTP", "waiting");
        return;
      }

      if (isFinishScreen()) {
        await handleFinishStep();
        return;
      }

      // Questions appeared after OTP (Course Feedback flow)
      const hasQuestions = Array.from(document.querySelectorAll(
        "input[name='option_id'], input[type='radio'], label.form-check-label"
      )).some(el => !el.closest("#amrita-automator-widget") && isVisible(el));

      if (hasQuestions) {
        log("OTP verified! Answering questions...");
        await sleep(500);
        handleFeedbackForm();
        return;
      }

      // Course feedback: if no questions appeared, something went wrong
      if (originListPage === "course-feedback-list" || window.location.pathname.includes("course-feedback")) {
        log("⚠ Waiting for course questions after OTP. Check portal.");
        updateBadge("CHECK FORM", "waiting");
        return;
      }

      // Class TLP: OTP is the last step
      log("✅ Verified! Closing tab and refreshing portal...");
      await sleep(800);
      closeAndRefreshPortal();
    } else {
      log("❌ Validate button not found! Try manually.");
      updateBadge("MANUAL OTP", "waiting");
    }
  }

  // ══════════════════════════════════════════════════════════
  // 5. DOM SELECTORS & HELPERS
  // ══════════════════════════════════════════════════════════

  function isOnOtpScreen() {
    // Class TLP step 16
    const activeStep = document.querySelector(".step-item.active");
    if (activeStep && activeStep.getAttribute("data-step") === "16") return true;

    // SEND OTP button visible
    const sendOtpBtn = findButtonByText(/send\s*otp/i);
    if (sendOtpBtn && isVisible(sendOtpBtn)) return true;

    // Validate button + OTP input both visible
    const validateBtn = findButtonByText(/validate/i);
    const otpInput = findOtpInput();
    if (validateBtn && isVisible(validateBtn) && otpInput && isVisible(otpInput)) return true;

    // Verification text with no radio buttons
    const bodyText = document.body ? (document.body.innerText || "") : "";
    if (/verify\s*OTP|OTP\s*which\s*will\s*be\s*sending/i.test(bodyText)) {
      const radios = Array.from(document.querySelectorAll("input[name='option_id'], input[type='radio']"))
        .filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
      if (radios.length === 0) return true;
    }

    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
    if (el.offsetParent === null && style.position !== "fixed") return false;
    return true;
  }

  /**
   * Select the first answer option.
   * Uses native checked setter to bypass React/Angular synthetic events.
   */
  function selectFirstOption() {
    const nativeCheckedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");

    // 1. Named radios (option_id)
    const namedRadios = Array.from(document.querySelectorAll("input[name='option_id']"))
      .filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
    if (namedRadios.length > 0) {
      const first = namedRadios[0];
      if (nativeCheckedSetter && nativeCheckedSetter.set) {
        nativeCheckedSetter.set.call(first, true);
      }
      first.checked = true;
      first.click();
      first.dispatchEvent(new Event("change", { bubbles: true }));
      // Also click associated label
      if (first.id) {
        const lbl = document.querySelector(`label[for='${first.id}']`);
        if (lbl) lbl.click();
      }
      return true;
    }

    // 2. Any visible radio on page
    const allRadios = Array.from(document.querySelectorAll("input[type='radio']"))
      .filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
    if (allRadios.length > 0) {
      const first = allRadios[0];
      if (nativeCheckedSetter && nativeCheckedSetter.set) {
        nativeCheckedSetter.set.call(first, true);
      }
      first.checked = true;
      first.click();
      first.dispatchEvent(new Event("change", { bubbles: true }));
      if (first.id) {
        const lbl = document.querySelector(`label[for='${first.id}']`);
        if (lbl) lbl.click();
      }
      return true;
    }

    // 3. Custom radio cards / option labels
    const optionCards = Array.from(document.querySelectorAll(
      "label.form-check-label, .custom-radio-card, .option-card"
    )).filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
    if (optionCards.length > 0) {
      optionCards[0].click();
      return true;
    }

    return false;
  }

  /**
   * Find the correct "proceed" button with strict priority order.
   * Priority: submit_ans (TLP) → Save & Next → Next → Submit (non-feedback/non-finish)
   */
  function findSubmitNextButton() {
    const allClickables = document.querySelectorAll(
      "button, a, input[type='submit'], input[type='button'], .btn"
    );

    let saveAndNextBtn = null;
    let nextBtn       = null;
    let submitBtn     = null;

    for (const b of allClickables) {
      if (b.closest("#amrita-automator-widget")) continue;
      if (!isVisible(b)) continue;

      const text = (b.textContent || b.value || "").trim();
      const textL = text.toLowerCase();
      const name = (b.getAttribute("name") || "").toLowerCase();

      // Skip back/cancel/close/resend/finish buttons
      if (/\b(back|prev|cancel|close|resend|finish)\b/i.test(textL)) continue;

      // #1 Highest priority: TLP's submit_ans button (Save & Next)
      if (name === "submit_ans") return b;

      // #2 "Save & Next" text
      if (/save\s*[&]\s*next/i.test(text)) return b;

      // #3 "Next" button
      if (/^next$/i.test(text) || b.classList.contains("next-btn")) {
        if (!nextBtn) nextBtn = b;
        continue;
      }

      // #4 Generic "Submit" (not for feedback list, not OTP validate)
      if (/\bsubmit\b/i.test(textL) && !/feedback/i.test(textL) && !/otp/i.test(textL) && !/validate/i.test(textL)) {
        if (!submitBtn) submitBtn = b;
        continue;
      }
    }

    return saveAndNextBtn || nextBtn || submitBtn || null;
  }

  function findButtonByText(regex) {
    const buttons = document.querySelectorAll("button, a, input[type='button'], input[type='submit'], .btn");
    for (const b of buttons) {
      if (b.closest("#amrita-automator-widget")) continue;
      const t = (b.textContent || b.value || "").trim();
      if (regex.test(t) && isVisible(b)) return b;
    }
    return null;
  }

  function findOtpInput() {
    // By placeholder
    const byPlaceholder = document.querySelector(
      "input[placeholder*='OTP' i], input[placeholder*='Email OTP' i], input[placeholder*='otp' i]"
    );
    if (byPlaceholder && !byPlaceholder.closest("#amrita-automator-widget") && isVisible(byPlaceholder)) {
      return byPlaceholder;
    }

    // By context text
    const allInputs = document.querySelectorAll("input[type='text'], input:not([type])");
    for (const inp of allInputs) {
      if (inp.closest("#amrita-automator-widget")) continue;
      if (inp.id === "aaw-manual-otp-input") continue;
      if (!isVisible(inp)) continue;
      if (inp.type === "radio" || inp.type === "checkbox" || inp.type === "hidden" ||
          inp.type === "submit" || inp.type === "button") continue;

      const parent = inp.closest("div, form, section");
      if (parent) {
        const pText = parent.innerText || "";
        if (/otp|verification/i.test(pText)) return inp;
      }
    }

    // Any visible non-search text input
    for (const inp of allInputs) {
      if (inp.closest("#amrita-automator-widget")) continue;
      if (inp.id === "aaw-manual-otp-input") continue;
      if (!isVisible(inp)) continue;
      if (/search|email|name|phone|mobile/i.test(inp.placeholder || inp.name || "")) continue;
      return inp;
    }

    return null;
  }

  function getCurrentStepNumber() {
    const activeStep = document.querySelector(".step-item.active");
    if (activeStep) return activeStep.getAttribute("data-step") || "";
    const params = new URLSearchParams(window.location.search);
    return params.get("c") || "";
  }

  function dismissPopups() {
    const swalBtns = document.querySelectorAll(".swal2-confirm, .swal2-actions button, .bootbox-accept");
    for (const b of swalBtns) {
      if (/ok|close|done|continue|confirm|yes/i.test((b.textContent || b.value || "").trim())) b.click();
    }
    const modalBtns = document.querySelectorAll(".modal.show button, .modal.show .close, .modal-footer button");
    for (const b of modalBtns) {
      if (/ok|close|done|continue|confirm|yes/i.test((b.textContent || b.value || "").trim())) b.click();
    }
  }

  function checkIfDone() {
    if (isFinishScreen()) { handleFinishStep(); return; }

    const text = (document.body.innerText || "").toLowerCase();
    if (text.includes("thank you") || text.includes("submitted successfully") ||
        text.includes("feedback has been submitted") || text.includes("can not update feedback")) {
      log("✅ Feedback completed! Closing...");
      const finishBtn = findFinishButton();
      if (finishBtn) { handleFinishStep(); } else { closeAndRefreshPortal(); }
    } else {
      log("Waiting for page content...");
      setTimeout(() => { if (isRunning) handleFeedbackForm(); }, 1500);
    }
  }

  function closeAndRefreshPortal() {
    if (isReturningToList) return;
    isReturningToList = true;

    // Keep automation alive for when list page loads
    localStorage.setItem("amrita_auto_running", "true");
    isRunning = true;

    chrome.runtime.sendMessage(
      { action: "CLOSE_AND_REFRESH_PORTAL", origin: originListPage },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          // Fallback: navigate in current tab
          const listUrl = originListPage === "class-feedback"
            ? "https://students.amrita.edu/client/class-feedback"
            : "https://students.amrita.edu/client/course-feedback-list";
          window.location.href = listUrl;
        }
      }
    );
  }

  // ══════════════════════════════════════════════════════════
  // FLOATING UI WIDGET
  // ══════════════════════════════════════════════════════════
  function createWidget() {
    if (document.getElementById("amrita-automator-widget")) return;

    const pt = getPageType();
    let readyMsg = "Ready. Click 'Start Auto-Submit All' to begin.";
    if (pt === "LIST_PAGE") {
      readyMsg = originListPage === "class-feedback"
        ? "On Class TLP Feedback list. Click 'Start' to begin."
        : "On Course Feedback list. Click 'Start' to begin.";
    } else if (pt === "FORM_PAGE") {
      readyMsg = "On Feedback Form. Click 'Start' to auto-answer.";
    }

    const widget = document.createElement("div");
    widget.id = "amrita-automator-widget";
    widget.innerHTML = `
      <div class="aaw-header" tabindex="0" role="group" aria-label="Move feedback panel. Drag or use arrow keys; Shift moves faster.">
        <div class="aaw-brand"><span class="aaw-grip" aria-hidden="true">⠿</span><div><div class="aaw-title">Amrita Feedback</div><div class="aaw-subtitle">Drag to move</div></div></div>
        <div class="aaw-header-actions">
          <a class="aaw-btn-icon aaw-github-star" href="https://github.com/Ganesh2006646/Amrita-Feedback-Automation" target="_blank" rel="noopener noreferrer" title="Star on GitHub" aria-label="Star on GitHub (opens repository in a new tab)"><span aria-hidden="true">☆</span></a>
          <button type="button" class="aaw-btn-icon" id="aaw-min-btn" title="Minimize panel" aria-label="Minimize panel" aria-expanded="true">−</button>
          <button type="button" class="aaw-btn-icon aaw-close-btn" id="aaw-close-btn" title="Close panel (click extension icon to reopen)" aria-label="Close panel">×</button>
        </div>
      </div>
      <div class="aaw-body">
        <div class="aaw-info-row">
          <span>Status:</span>
          <span class="aaw-status-badge idle" id="aaw-badge">READY</span>
        </div>
        <div class="aaw-log" id="aaw-log-box">${readyMsg}</div>
        <div class="aaw-actions">
          <button type="button" class="aaw-btn aaw-btn-start" id="aaw-start-btn">Start Auto-Submit All</button>
          <button type="button" class="aaw-btn aaw-btn-stop" id="aaw-stop-btn" style="display:none;">Pause automation</button>
        </div>
        <div class="aaw-otp-section">
          <label class="aaw-field-label" for="aaw-manual-otp-input">OTP verification</label>
          <button type="button" class="aaw-btn aaw-btn-check" id="aaw-check-outlook-btn">Fetch OTP from Outlook</button>
          <div class="aaw-manual-otp-group">
            <input type="text" class="aaw-input" id="aaw-manual-otp-input" placeholder="Enter OTP manually" autocomplete="off" spellcheck="false">
            <button type="button" class="aaw-btn aaw-btn-check" id="aaw-submit-manual-otp-btn">Submit OTP</button>
          </div>
        </div>
        <div class="aaw-footer">Selects Option 1 and submits feedback automatically. Click the extension icon to reopen after closing.</div>
      </div>
    `;

    document.body.appendChild(widget);

    // ── Event listeners ──
    document.getElementById("aaw-start-btn").addEventListener("click", startAutomation);

    document.getElementById("aaw-stop-btn").addEventListener("click", () => {
      stopAutomation();
      log("⏸ Paused by user.");
      updateBadge("PAUSED", "idle");
    });

    document.getElementById("aaw-min-btn").addEventListener("click", () => {
      const minimized = widget.classList.toggle("minimized");
      const button = document.getElementById("aaw-min-btn");
      button.textContent = minimized ? "+" : "−";
      button.setAttribute("aria-expanded", String(!minimized));
      button.setAttribute("aria-label", minimized ? "Expand panel" : "Minimize panel");
      button.title = minimized ? "Expand panel" : "Minimize panel";
      widget.dispatchEvent(new Event("aaw-resize"));
    });

    document.getElementById("aaw-close-btn").addEventListener("click", () => {
      widget.remove();
    });

    document.getElementById("aaw-check-outlook-btn").addEventListener("click", () => {
      log("Manually fetching OTP...");
      handleOtpFlow();
    });

    document.getElementById("aaw-submit-manual-otp-btn").addEventListener("click", () => {
      const code = document.getElementById("aaw-manual-otp-input").value.trim();
      if (code) {
        log(`Manual OTP: "${code}"`);
        isRunning = true;
        localStorage.setItem("amrita_auto_running", "true");
        enterAndValidateOtp(code);
      } else {
        log("Enter an OTP first.");
      }
    });

    setupWidgetMovement(widget);

    if (isRunning) {
      document.getElementById("aaw-start-btn").style.display = "none";
      document.getElementById("aaw-stop-btn").style.display = "flex";
    }
  }

  function setupWidgetMovement(widget) {
    const header = widget.querySelector(".aaw-header");
    let drag = null;

    function place(left, top) {
      const rect = widget.getBoundingClientRect();
      const x = Math.max(0, Math.min(left, Math.max(0, window.innerWidth - rect.width)));
      const y = Math.max(0, Math.min(top, Math.max(0, window.innerHeight - rect.height)));
      Object.assign(widget.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
    }

    function keepInView() {
      const rect = widget.getBoundingClientRect();
      place(rect.left, rect.top);
    }

    header.addEventListener("pointerdown", event => {
      if (event.target.closest("button, a") || !event.isPrimary || event.button !== 0) return;
      const rect = widget.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      widget.classList.add("aaw-dragging");
      event.preventDefault();
      header.focus({ preventScroll: true });
    });

    header.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      place(event.clientX - drag.x, event.clientY - drag.y);
    });

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      widget.classList.remove("aaw-dragging");
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    }

    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
    header.addEventListener("lostpointercapture", endDrag);

    header.addEventListener("keydown", event => {
      if (event.target !== header) return;
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      const rect = widget.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 10;
      place(rect.left + direction[0] * step, rect.top + direction[1] * step);
    });

    window.addEventListener("resize", keepInView);
    widget.addEventListener("aaw-resize", keepInView);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(keepInView).observe(widget);
    keepInView();
  }

  // ══════════════════════════════════════════════════════════
  // AUTOMATION CONTROL
  // ══════════════════════════════════════════════════════════
  function startAutomation() {
    isRunning = true;
    localStorage.setItem("amrita_auto_running", "true");

    const path = window.location.pathname.toLowerCase();
    if (path.includes("class-feedback")) {
      originListPage = "class-feedback";
      localStorage.setItem("amrita_origin_list", "class-feedback");
    } else {
      originListPage = "course-feedback-list";
      localStorage.setItem("amrita_origin_list", "course-feedback-list");
    }

    document.getElementById("aaw-start-btn").style.display = "none";
    document.getElementById("aaw-stop-btn").style.display = "flex";
    updateBadge("RUNNING", "running");
    log("▶ Automation started!");
    runNextStep();
  }

  function stopAutomation() {
    isRunning = false;
    localStorage.removeItem("amrita_auto_running"); // Clean removal, not "false"
    const startBtn = document.getElementById("aaw-start-btn");
    const stopBtn = document.getElementById("aaw-stop-btn");
    if (startBtn) startBtn.style.display = "flex";
    if (stopBtn) stopBtn.style.display = "none";
  }

  function log(msg) {
    console.log("[Amrita] " + msg);
    const box = document.getElementById("aaw-log-box");
    if (box) box.innerText = msg;
  }

  function updateBadge(text, stateClass) {
    const badge = document.getElementById("aaw-badge");
    if (badge) {
      badge.innerText = text;
      badge.className = "aaw-status-badge " + stateClass;
    }
  }

})();
