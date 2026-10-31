// amrita.js - Full automation for Amrita Student Portal Feedback
// Supports BOTH: Class TLP Feedback and Course Feedback with full OTP & Finish loop

(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════
  // GUARD: one instance per document lifetime
  // ══════════════════════════════════════════════════════════
  if (window.__amrita_automator_running) return;
  window.__amrita_automator_running = true;

  console.log("[Amrita Automator] Injected on:", window.location.href);

  // ──────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────
  let isRunning        = localStorage.getItem("amrita_auto_running") === "true";
  let lastUsedOtp      = localStorage.getItem("amrita_last_otp") || "";
  let originListPage   = localStorage.getItem("amrita_origin_list") || "";
  let isReturningToList = false;

  // ★ Step lock — prevents two async flows running at the same time
  let isStepRunning = false;

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
    setTimeout(() => runNextStep(), 1500);
  }

  // ══════════════════════════════════════════════════════════
  // REOPEN WIDGET on extension icon click
  // ══════════════════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "REOPEN_WIDGET") {
      if (!document.getElementById("amrita-automator-widget")) {
        createWidget();
        log("Widget reopened. Click 'Start' to begin.");
      }
    }
  });

  // ══════════════════════════════════════════════════════════
  // SPA NAVIGATION WATCHER — debounced, respects step lock
  // ══════════════════════════════════════════════════════════
  let _lastHref = window.location.href;
  let _spaDebounceTimer = null;

  // ★ Debounced callback — fires at most once per 600 ms
  const _spaObserver = new MutationObserver(() => {
    if (window.location.href === _lastHref) return; // URL unchanged — ignore
    clearTimeout(_spaDebounceTimer);
    _spaDebounceTimer = setTimeout(() => {
      if (window.location.href === _lastHref) return;
      _lastHref = window.location.href;
      onSpaNavigate();
    }, 600);
  });
  _spaObserver.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("popstate",   onSpaNavigate);
  window.addEventListener("hashchange", onSpaNavigate);

  function onSpaNavigate() {
    // ★ Don't start a new step if one is already running
    if (isStepRunning) {
      console.log("[Amrita] SPA nav detected but step is running — skipping re-trigger");
      return;
    }

    console.log("[Amrita] SPA navigation →", window.location.href);

    setTimeout(() => {
      // Re-track origin
      const p = window.location.pathname.toLowerCase();
      const h = window.location.href.toLowerCase();
      if (p.includes("course-feedback-list")) {
        originListPage = "course-feedback-list";
        localStorage.setItem("amrita_origin_list", "course-feedback-list");
      } else if (p.includes("class-feedback") && !h.includes("cid=") && !h.includes("fid=")) {
        originListPage = "class-feedback";
        localStorage.setItem("amrita_origin_list", "class-feedback");
      }

      if (!document.getElementById("amrita-automator-widget")) createWidget();

      if (isRunning && !isStepRunning && getPageType() !== "UNKNOWN") {
        isReturningToList = false;
        updateBadge("RUNNING", "running");
        log("Resuming after navigation...");
        runNextStep();
      }
    }, 1200);
  }

  // ══════════════════════════════════════════════════════════
  // MAIN FLOW CONTROLLER
  // ══════════════════════════════════════════════════════════
  async function runNextStep() {
    if (!isRunning) return;
    if (isStepRunning) { // ★ Prevent concurrent execution
      console.log("[Amrita] runNextStep skipped — already running");
      return;
    }

    isStepRunning = true;
    isReturningToList = false;

    try {
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
    } finally {
      isStepRunning = false;
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

      // Broad search if not in table
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

    if (!submitBtn) {
      log("🎉 All courses completed! Great job!");
      updateBadge("ALL DONE", "completed");
      stopAutomation();
      return;
    }

    log(`Found pending course: "${courseName.slice(0, 35)}". Opening...`);
    updateBadge("OPENING", "running");
    await sleep(600);

    const urlBefore = window.location.href;

    // ★ Set lock BEFORE clicking so onSpaNavigate won't double-trigger
    isStepRunning = true;
    submitBtn.click();

    // Wait up to 6 s for SPA or full navigation
    let navigated = false;
    for (let w = 0; w < 24; w++) {
      await sleep(250);
      if (window.location.href !== urlBefore) { navigated = true; break; }
    }

    if (navigated) {
      // Update href tracker so debounced observer doesn't re-fire
      _lastHref = window.location.href;
      // Let page render, then handle the form
      await sleep(1200);
      isStepRunning = false;
      if (isRunning) await handleFeedbackForm();
    } else {
      // No URL change — might still be a form loaded inside same URL
      await sleep(600);
      isStepRunning = false;
      if (getPageType() === "FORM_PAGE") {
        if (isRunning) await handleFeedbackForm();
      } else {
        log("⚠ No navigation detected. Retrying scan...");
        await sleep(1500);
        if (isRunning) await handleListPage();
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // 2. FORM PAGE: UNIFIED HANDLER
  //    Priority: OTP → Finish → Answer questions → Next
  // ══════════════════════════════════════════════════════════
  async function handleFeedbackForm() {
    if (!isRunning) return;

    // OTP takes priority
    if (isOnOtpScreen()) {
      await handleOtpFlow();
      return;
    }

    if (isFinishScreen()) {
      await handleFinishStep();
      return;
    }

    updateBadge("ANSWERING", "running");

    // ★ Step 1: Select option FIRST — DO NOT click the radio itself (causes race)
    const selected = selectFirstOption();

    if (!selected) {
      // No radio options visible — check for other states
      await sleep(800);
      if (isOnOtpScreen()) {
        await handleOtpFlow();
      } else if (isFinishScreen()) {
        await handleFinishStep();
      } else {
        checkIfDone();
      }
      return;
    }

    const stepNum = getCurrentStepNumber();
    log(`Question ${stepNum}: Selected Option 1 ✓`);

    // ★ Step 2: Wait a moment for the UI to register the selection
    await sleep(600);

    // ★ Step 3: THEN find and click the next/save button
    const nextBtn = findSubmitNextButton();
    if (nextBtn) {
      const btnText = (nextBtn.textContent || nextBtn.value || "").trim();
      log(`Clicking '${btnText}'...`);
      await sleep(300);
      nextBtn.click();
      // After click, SPA will advance — wait before next iteration
      await sleep(800);
    } else {
      log("⚠ Next/Submit button not found, retrying...");
      await sleep(1500);
      if (isRunning) await handleFeedbackForm();
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
      if (isRunning) await handleFeedbackForm();
      return;
    }

    await sleep(400);
    log("Clicking 'Finish' button...");
    finishBtn.click();

    log("Waiting for confirmation dialog...");
    await waitForAndClickDialogOk(6000);

    dismissPopups();
    await sleep(1000);
    dismissPopups();

    log("✅ Feedback completed! Closing tab...");
    updateBadge("DONE", "completed");
    await sleep(800);

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
        const secondary = findDialogOkButton();
        if (secondary) { secondary.click(); await sleep(600); }
        return true;
      }
      await sleep(200);
    }
    return false;
  }

  function findDialogOkButton() {
    const selectors = [
      ".swal2-confirm", ".swal2-actions button",
      ".swal-button--confirm", ".swal-button",
      ".bootbox-accept", "[data-bb-handler='confirm']", "[data-bb-handler='ok']"
    ];
    for (const sel of selectors) {
      const b = document.querySelector(sel);
      if (b && !b.closest("#amrita-automator-widget") && isVisible(b)) return b;
    }

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

    const sendBtn = findButtonByText(/send\s*otp/i);
    if (sendBtn && isVisible(sendBtn)) {
      log("Clicking 'SEND OTP' button...");
      sendBtn.click();
      await sleep(3000);
    }

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
    if (!input) { log("❌ OTP input field not found!"); return; }

    // Use native value setter to bypass React/Angular
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

      if (isOnOtpScreen()) {
        log("⚠ OTP still pending. Check portal and retry OTP manually.");
        updateBadge("CHECK OTP", "waiting");
        return;
      }

      if (isFinishScreen()) {
        await handleFinishStep();
        return;
      }

      const hasQuestions = Array.from(document.querySelectorAll(
        "input[name='option_id'], input[type='radio'], label.form-check-label"
      )).some(el => !el.closest("#amrita-automator-widget") && isVisible(el));

      if (hasQuestions) {
        log("OTP verified! Answering questions...");
        await sleep(500);
        await handleFeedbackForm();
        return;
      }

      if (originListPage === "course-feedback-list" || window.location.pathname.includes("course-feedback")) {
        log("⚠ Waiting for course questions after OTP.");
        updateBadge("CHECK FORM", "waiting");
        return;
      }

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
    const activeStep = document.querySelector(".step-item.active");
    if (activeStep && activeStep.getAttribute("data-step") === "16") return true;

    const sendOtpBtn = findButtonByText(/send\s*otp/i);
    if (sendOtpBtn && isVisible(sendOtpBtn)) return true;

    const validateBtn = findButtonByText(/validate/i);
    const otpInput = findOtpInput();
    if (validateBtn && isVisible(validateBtn) && otpInput && isVisible(otpInput)) return true;

    const bodyText = document.body ? (document.body.innerText || "") : "";
    if (/verify\s*OTP|OTP\s*which\s*will\s*be\s*sending/i.test(bodyText)) {
      const visibleRadios = Array.from(document.querySelectorAll("input[name='option_id'], input[type='radio']"))
        .filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
      if (visibleRadios.length === 0) return true;
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
   * ★ KEY FIX: Does NOT call .click() on the radio input itself —
   *   that would trigger portal click-handlers which may advance the
   *   page before we explicitly click Next.
   *   Instead: set checked via native setter + dispatch events + click label only.
   */
  function selectFirstOption() {
    const nativeChecked = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");

    // 1. Named radios (option_id)
    const namedRadios = Array.from(document.querySelectorAll("input[name='option_id']"))
      .filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
    if (namedRadios.length > 0) {
      const first = namedRadios[0];
      if (nativeChecked && nativeChecked.set) nativeChecked.set.call(first, true);
      first.checked = true;
      first.dispatchEvent(new Event("input",  { bubbles: true }));
      first.dispatchEvent(new Event("change", { bubbles: true }));
      // Click the label (safe — doesn't submit the form)
      if (first.id) {
        const lbl = document.querySelector(`label[for='${first.id}']`);
        if (lbl) { lbl.click(); return true; }
      }
      const fallbackLabel = first.closest("label") ||
        first.parentElement && first.parentElement.querySelector("label");
      if (fallbackLabel) { fallbackLabel.click(); return true; }
      return true;
    }

    // 2. Any visible radio on page
    const allRadios = Array.from(document.querySelectorAll("input[type='radio']"))
      .filter(el => !el.closest("#amrita-automator-widget") && isVisible(el));
    if (allRadios.length > 0) {
      const first = allRadios[0];
      if (nativeChecked && nativeChecked.set) nativeChecked.set.call(first, true);
      first.checked = true;
      first.dispatchEvent(new Event("input",  { bubbles: true }));
      first.dispatchEvent(new Event("change", { bubbles: true }));
      if (first.id) {
        const lbl = document.querySelector(`label[for='${first.id}']`);
        if (lbl) { lbl.click(); return true; }
      }
      const fallbackLabel = first.closest("label") ||
        (first.parentElement && first.parentElement.querySelector("label"));
      if (fallbackLabel) { fallbackLabel.click(); return true; }
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
   * Find the correct "proceed" button — strict priority:
   * 1. [name=submit_ans]  — TLP "Save & Next"
   * 2. "Save & Next" text
   * 3. "Next" text / .next-btn class
   * 4. "Submit" (excluding feedback/OTP/validate/finish words)
   */
  function findSubmitNextButton() {
    const allClickables = document.querySelectorAll(
      "button, a, input[type='submit'], input[type='button'], .btn"
    );

    let nextBtn   = null;
    let submitBtn = null;

    for (const b of allClickables) {
      if (b.closest("#amrita-automator-widget")) continue;
      if (!isVisible(b)) continue;

      const text  = (b.textContent || b.value || "").trim();
      const textL = text.toLowerCase();
      const name  = (b.getAttribute("name") || "").toLowerCase();

      // Skip navigation buttons
      if (/\b(back|prev|cancel|close|resend|finish|send\s*otp)\b/i.test(textL)) continue;

      // #1 TLP Save & Next (by name attribute)
      if (name === "submit_ans") return b;

      // #2 Save & Next (by text)
      if (/save\s*[&]\s*next/i.test(text)) return b;

      // #3 Next button
      if (/^next$/i.test(text) || b.classList.contains("next-btn")) {
        if (!nextBtn) nextBtn = b;
        continue;
      }

      // #4 Generic Submit (not feedback-list, not OTP, not validate)
      if (/\bsubmit\b/i.test(textL) &&
          !/feedback/i.test(textL) &&
          !/otp/i.test(textL) &&
          !/validate/i.test(textL) &&
          !/finish/i.test(textL)) {
        if (!submitBtn) submitBtn = b;
        continue;
      }
    }

    return nextBtn || submitBtn || null;
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
    const byPlaceholder = document.querySelector(
      "input[placeholder*='OTP' i], input[placeholder*='Email OTP' i], input[placeholder*='otp' i]"
    );
    if (byPlaceholder && !byPlaceholder.closest("#amrita-automator-widget") && isVisible(byPlaceholder)) {
      return byPlaceholder;
    }

    const allInputs = document.querySelectorAll("input[type='text'], input:not([type])");
    for (const inp of allInputs) {
      if (inp.closest("#amrita-automator-widget")) continue;
      if (inp.id === "aaw-manual-otp-input") continue;
      if (!isVisible(inp)) continue;
      if (["radio","checkbox","hidden","submit","button"].includes(inp.type)) continue;
      const parent = inp.closest("div, form, section");
      if (parent && /otp|verification/i.test(parent.innerText || "")) return inp;
    }

    // Fallback: first visible non-search text input
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
      setTimeout(() => { if (isRunning && !isStepRunning) handleFeedbackForm(); }, 1500);
    }
  }

  function closeAndRefreshPortal() {
    if (isReturningToList) return;
    isReturningToList = true;

    localStorage.setItem("amrita_auto_running", "true");
    isRunning = true;

    chrome.runtime.sendMessage(
      { action: "CLOSE_AND_REFRESH_PORTAL", origin: originListPage },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
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
      <div class="aaw-header" tabindex="0" role="group" aria-label="Move feedback panel.">
        <div class="aaw-brand"><span class="aaw-grip" aria-hidden="true">⠿</span><div><div class="aaw-title">Amrita Feedback</div><div class="aaw-subtitle">Drag to move</div></div></div>
        <div class="aaw-header-actions">
          <a class="aaw-btn-icon aaw-github-star" href="https://github.com/Ganesh2006646/Amrita-Feedback-Automation" target="_blank" rel="noopener noreferrer" title="Star on GitHub" aria-label="Star on GitHub"><span aria-hidden="true">☆</span></a>
          <button type="button" class="aaw-btn-icon" id="aaw-min-btn" title="Minimize" aria-label="Minimize panel" aria-expanded="true">−</button>
          <button type="button" class="aaw-btn-icon aaw-close-btn" id="aaw-close-btn" title="Close (click extension icon to reopen)" aria-label="Close panel">×</button>
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
        <div class="aaw-footer">Selects Option 1 automatically. Click extension icon to reopen after closing.</div>
      </div>
    `;

    document.body.appendChild(widget);

    document.getElementById("aaw-start-btn").addEventListener("click", startAutomation);

    document.getElementById("aaw-stop-btn").addEventListener("click", () => {
      stopAutomation();
      log("⏸ Paused by user.");
      updateBadge("PAUSED", "idle");
    });

    document.getElementById("aaw-min-btn").addEventListener("click", () => {
      const minimized = widget.classList.toggle("minimized");
      const btn = document.getElementById("aaw-min-btn");
      btn.textContent = minimized ? "+" : "−";
      btn.setAttribute("aria-expanded", String(!minimized));
      btn.setAttribute("aria-label", minimized ? "Expand panel" : "Minimize panel");
      btn.title = minimized ? "Expand panel" : "Minimize panel";
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
      const x = Math.max(0, Math.min(left, Math.max(0, window.innerWidth  - rect.width)));
      const y = Math.max(0, Math.min(top,  Math.max(0, window.innerHeight - rect.height)));
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

    header.addEventListener("pointerup",           endDrag);
    header.addEventListener("pointercancel",        endDrag);
    header.addEventListener("lostpointercapture",   endDrag);

    header.addEventListener("keydown", event => {
      if (event.target !== header) return;
      const directions = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      const dir = directions[event.key];
      if (!dir) return;
      event.preventDefault();
      const rect = widget.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 10;
      place(rect.left + dir[0] * step, rect.top + dir[1] * step);
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
    isStepRunning = false;
    localStorage.removeItem("amrita_auto_running");
    const startBtn = document.getElementById("aaw-start-btn");
    const stopBtn  = document.getElementById("aaw-stop-btn");
    if (startBtn) startBtn.style.display = "flex";
    if (stopBtn)  stopBtn.style.display  = "none";
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
