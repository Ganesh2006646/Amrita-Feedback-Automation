// amrita.js - Full automation for Amrita Student Portal Feedback
// Supports BOTH: Class TLP Feedback and Course Feedback with full OTP & Finish loop

(function () {
  "use strict";

  console.log("[Amrita Automator] Injected on:", window.location.href);

  // Auto-accept native window.confirm & window.alert in page context (MAIN world)
  injectDialogOverrides();

  let isRunning = localStorage.getItem("amrita_auto_running") === "true";
  let lastUsedOtp = localStorage.getItem("amrita_last_otp") || "";
  let originListPage = localStorage.getItem("amrita_origin_list") || "";

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================
  // INJECT OVERRIDES FOR NATIVE DIALOGS
  // ==========================================
  function injectDialogOverrides() {
    try {
      const s = document.createElement("script");
      s.textContent = `
        (function() {
          if (window.__amrita_dialog_overridden) return;
          window.__amrita_dialog_overridden = true;
          const origConfirm = window.confirm;
          window.confirm = function(msg) {
            console.log("[Amrita Page] Auto-accepting native confirm:", msg);
            return true;
          };
          const origAlert = window.alert;
          window.alert = function(msg) {
            console.log("[Amrita Page] Auto-dismissing native alert:", msg);
            return true;
          };
        })();
      `;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      console.warn("[Amrita] Dialog override notice:", e);
    }
  }

  // ==========================================
  // PAGE TYPE DETECTION
  // ==========================================
  function getPageType() {
    const path = window.location.pathname.toLowerCase();
    const href = window.location.href.toLowerCase();

    // List pages
    if (path.includes("course-feedback-list")) {
      return "LIST_PAGE";
    }
    if (path.includes("class-feedback") && !href.includes("cid=") && !href.includes("fid=")) {
      return "LIST_PAGE";
    }

    // Form pages (handles /client/feedback, /client/course-feedback, or any feedback with params)
    if (path.includes("feedback") || href.includes("cid=") || href.includes("fid=")) {
      return "FORM_PAGE";
    }

    return "UNKNOWN";
  }

  const pageType = getPageType();
  console.log("[Amrita] Page type:", pageType);

  // Track origin list page if we are on one
  const currentPath = window.location.pathname.toLowerCase();
  if (currentPath.includes("course-feedback-list")) {
    originListPage = "course-feedback-list";
    localStorage.setItem("amrita_origin_list", "course-feedback-list");
  } else if (currentPath.includes("class-feedback")) {
    originListPage = "class-feedback";
    localStorage.setItem("amrita_origin_list", "class-feedback");
  }

  // Create floating widget
  createWidget();

  // If automation is running, auto-resume
  if (isRunning && pageType !== "UNKNOWN") {
    updateBadge("RUNNING", "running");
    log("Auto-resuming feedback automation...");
    setTimeout(() => runNextStep(), 1000);
  }

  // ==========================================
  // MAIN FLOW CONTROLLER
  // ==========================================
  async function runNextStep() {
    if (!isRunning) return;

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

  // ==========================================
  // 1. LIST PAGE: SCAN & SUBMIT NEXT COURSE
  // ==========================================
  async function handleListPage() {
    log("Scanning courses for pending feedback...");
    updateBadge("SCANNING", "running");

    let submitBtn = null;
    let courseName = "";

    for (let attempt = 0; attempt < 25; attempt++) {
      if (!isRunning) return;

      const rows = document.querySelectorAll("table tbody tr, table tr");
      for (const row of rows) {
        const text = (row.innerText || "").toLowerCase();
        // Ignore rows that are already completed
        if (text.includes("completed") || text.includes("view feedback")) continue;

        const btns = row.querySelectorAll("button, a, input[type='button'], input[type='submit']");
        for (const b of btns) {
          const t = (b.textContent || b.value || "").trim();
          if (/submit\s*feedback/i.test(t)) {
            submitBtn = b;
            const cells = row.querySelectorAll("td");
            courseName = cells.length >= 2 ? cells[1].innerText.trim() : "Course";
            break;
          }
        }
        if (submitBtn) break;
      }

      // Broad search across page if not found in table rows
      if (!submitBtn) {
        const allBtns = document.querySelectorAll("button, a, input[type='button'], input[type='submit']");
        for (const b of allBtns) {
          if (b.closest("#amrita-automator-widget")) continue;
          const t = (b.textContent || b.value || "").trim();
          if (/submit\s*feedback/i.test(t) && !/view\s*feedback/i.test(t)) {
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
      await sleep(600);
      submitBtn.click();
    } else {
      log("🎉 All courses completed! Great job!");
      updateBadge("ALL DONE", "completed");
      stopAutomation();
    }
  }

  // ==========================================
  // 2. FORM PAGE: UNIFIED QUESTION, OTP & FINISH HANDLER
  // ==========================================
  async function handleFeedbackForm() {
    if (!isRunning) return;

    // STEP A: Check if we are on the final "Finish" screen (Course Feedback)
    if (isFinishScreen()) {
      await handleFinishStep();
      return;
    }

    // STEP B: Check if we are on the OTP screen (Step 16 in Class TLP OR start of Course Feedback)
    if (isOnOtpScreen()) {
      await handleOtpFlow();
      return;
    }

    // STEP C: Check if questions are present to answer
    updateBadge("ANSWERING", "running");

    const selected = selectFirstOption();
    if (selected) {
      const stepNum = getCurrentStepNumber();
      log(`Question ${stepNum}: Selected Option 1 ✓`);
      await sleep(400);

      const nextBtn = findSubmitNextButton();
      if (nextBtn) {
        const btnText = (nextBtn.textContent || nextBtn.value || "").trim();
        log(`Clicking '${btnText}'...`);
        nextBtn.click();
        // Page reload or dynamic step advance
      } else {
        log("⚠ Next button not found, retrying...");
        await sleep(1500);
        if (isRunning) handleFeedbackForm();
      }
    } else {
      // No radio options found — check if Finish screen or OTP screen appeared
      await sleep(1000);
      if (isFinishScreen()) {
        await handleFinishStep();
      } else if (isOnOtpScreen()) {
        await handleOtpFlow();
      } else {
        checkIfDone();
      }
    }
  }

  // ==========================================
  // 3. FINAL FINISH BUTTON & CONFIRMATION DIALOG HANDLER
  // ==========================================
  async function handleFinishStep() {
    log("Finish screen reached! Locating 'Finish' button...");
    updateBadge("FINISHING", "running");

    const finishBtn = findFinishButton();
    if (!finishBtn) {
      log("⚠ Finish button not found, retrying...");
      await sleep(1500);
      return;
    }

    await sleep(600);
    log("Clicking 'Finish' button...");
    finishBtn.click();

    // The user requested: "dialog box is ask us ok clcik than ; close that tab ; and refrest that tab"
    log("Waiting for confirmation dialog (OK)...");
    await waitForAndClickDialogOk(5000);

    // Dismiss any secondary / success popups
    dismissPopups();
    await sleep(1500);
    dismissPopups();

    log("✅ Course Feedback completed! Closing tab and refreshing portal...");
    updateBadge("DONE", "completed");
    await sleep(1200);

    closeAndRefreshPortal();
  }

  function isFinishScreen() {
    const bodyText = (document.body ? document.body.innerText : "") || "";
    // Matches the banner from user's screenshot: "Once you finished feedback, you can not update feedback."
    if (/once you finished feedback/i.test(bodyText) || /can not update feedback/i.test(bodyText)) {
      return true;
    }

    // Or Finish button is visible with NO question radios present
    const finishBtn = findFinishButton();
    const hasRadios = document.querySelector("input[name='option_id'], input[type='radio']");
    return finishBtn !== null && !hasRadios;
  }

  function findFinishButton() {
    const candidates = document.querySelectorAll("button, a, input[type='submit'], input[type='button'], .btn");
    for (const b of candidates) {
      if (b.closest("#amrita-automator-widget")) continue;
      const txt = (b.textContent || b.value || "").trim().toLowerCase();
      if (txt === "finish" || /^finish\b/i.test(txt)) {
        if (isVisible(b)) return b;
      }
    }
    const byClass = document.querySelector(".finish-btn, #finish-btn, [name='finish']");
    if (byClass && !byClass.closest("#amrita-automator-widget") && isVisible(byClass)) {
      return byClass;
    }
    return null;
  }

  async function waitForAndClickDialogOk(maxWaitMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const okBtn = findDialogOkButton();
      if (okBtn) {
        const label = (okBtn.textContent || okBtn.value || "OK").trim();
        log(`Clicking dialog confirmation '${label}'...`);
        okBtn.click();
        await sleep(1000);

        // Check for any secondary OK popup (e.g. "Success! Feedback recorded")
        const secondary = findDialogOkButton();
        if (secondary) {
          log("Clicking secondary dialog OK...");
          secondary.click();
          await sleep(800);
        }
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  function findDialogOkButton() {
    // 1. SweetAlert & Bootbox buttons
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
      if (b && !b.closest("#amrita-automator-widget") && isVisible(b)) {
        return b;
      }
    }

    // 2. Buttons inside visible modals
    const modals = document.querySelectorAll(
      ".modal.show, .modal[style*='display: block'], [role='dialog'], .swal2-container, .bootbox, .popup, .dialog"
    );
    for (const modal of modals) {
      const buttons = modal.querySelectorAll("button, a, input[type='button'], input[type='submit']");
      for (const b of buttons) {
        if (b.closest("#amrita-automator-widget")) continue;
        if (!isVisible(b)) continue;
        const txt = (b.textContent || b.value || "").trim().toLowerCase();
        if (/^(ok|yes|confirm|proceed|done|close|continue|agree)$/i.test(txt)) {
          return b;
        }
      }
      const primary = modal.querySelector(".btn-primary, .btn-danger, .btn-success");
      if (primary && isVisible(primary)) return primary;
    }

    // 3. Any visible button on page whose exact text is "OK" or "Yes"
    const allBtns = document.querySelectorAll("button, a, input[type='button'], input[type='submit']");
    for (const b of allBtns) {
      if (b.closest("#amrita-automator-widget")) continue;
      if (!isVisible(b)) continue;
      const txt = (b.textContent || b.value || "").trim().toLowerCase();
      if (txt === "ok" || txt === "yes") {
        return b;
      }
    }

    return null;
  }

  // ==========================================
  // 4. OTP HANDLING
  // ==========================================
  async function handleOtpFlow() {
    updateBadge("OTP FLOW", "waiting");

    // 1. Click SEND OTP button if visible
    const sendBtn = findButtonByText(/send\s*otp/i);
    if (sendBtn && isVisible(sendBtn)) {
      log("Clicking 'SEND OTP' button...");
      sendBtn.click();
      await sleep(3000);
    }

    // 2. Wait for OTP text input
    let otpInput = findOtpInput();
    if (!otpInput) {
      await sleep(2000);
      otpInput = findOtpInput();
    }

    if (!otpInput) {
      log("⚠ Waiting for OTP input box...");
      await sleep(1500);
      otpInput = findOtpInput();
    }

    log("Requesting latest OTP from Outlook tab...");
    updateBadge("WAITING OTP", "waiting");

    chrome.runtime.sendMessage(
      { action: "FETCH_OTP", lastOtp: lastUsedOtp },
      async (response) => {
        if (!isRunning) return;

        if (chrome.runtime.lastError) {
          log("⚠ Extension communication error. Enter OTP manually below.");
          updateBadge("MANUAL OTP", "waiting");
          return;
        }

        if (response && response.success && response.otp) {
          const otp = response.otp;
          log(`✅ Received OTP from Outlook: "${otp}"! Submitting...`);
          lastUsedOtp = otp;
          localStorage.setItem("amrita_last_otp", otp);
          await enterAndValidateOtp(otp);
        } else {
          const err = response ? response.error : "Could not reach Outlook tab";
          log(`⚠ ${err}`);
          log("You can also enter the OTP manually below and click 'Submit OTP'.");
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

    input.focus();
    input.value = "";
    input.value = otp;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    await sleep(700);

    const validateBtn = findButtonByText(/validate/i);
    if (validateBtn) {
      const vText = (validateBtn.textContent || validateBtn.value || "Validate").trim();
      log(`Clicking '${vText}'...`);
      validateBtn.click();
      updateBadge("VALIDATING", "running");

      await sleep(3500);
      await waitForAndClickDialogOk(3000);
      dismissPopups();
      await sleep(1000);

      // Check if Finish screen appeared
      if (isFinishScreen()) {
        await handleFinishStep();
        return;
      }

      // Check if questions appeared (Course Feedback flow)
      const hasQuestions = document.querySelector("input[name='option_id'], input[type='radio'], label.form-check-label");
      if (hasQuestions) {
        log("OTP verified! Proceeding to answer questions...");
        await sleep(500);
        handleFeedbackForm();
        return;
      }

      // If no questions and no finish button, form is complete (Class TLP flow)
      log("✅ Verified! Closing tab and refreshing portal...");
      await sleep(1000);
      closeAndRefreshPortal();
    } else {
      log("❌ Validate button not found!");
    }
  }

  // ==========================================
  // 5. DOM SELECTORS & HELPERS
  // ==========================================
  function isOnOtpScreen() {
    // Step 16 active in Class TLP
    const activeStep = document.querySelector(".step-item.active");
    if (activeStep && activeStep.getAttribute("data-step") === "16") return true;

    // SEND OTP button visible
    const sendOtpBtn = findButtonByText(/send\s*otp/i);
    if (sendOtpBtn && isVisible(sendOtpBtn)) return true;

    // Validate button visible with OTP input
    const validateBtn = findButtonByText(/validate/i);
    const otpInput = findOtpInput();
    if (validateBtn && otpInput && isVisible(validateBtn)) return true;

    // Verification text with no radio buttons
    const bodyText = document.body ? (document.body.innerText || "") : "";
    if (/verify\s*OTP|OTP\s*which\s*will\s*be\s*sending/i.test(bodyText)) {
      const radios = document.querySelectorAll("input[name='option_id'], input[type='radio']");
      if (radios.length === 0) return true;
    }

    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  function selectFirstOption() {
    // 1. Search for named radio inputs
    const namedRadios = document.querySelectorAll("input[name='option_id']");
    if (namedRadios.length > 0) {
      const first = namedRadios[0];
      first.checked = true;
      first.dispatchEvent(new Event("change", { bubbles: true }));

      if (first.id) {
        const label = document.querySelector(`label[for='${first.id}']`);
        if (label) {
          label.click();
          return true;
        }
      }
      const label = document.querySelector("label.form-check-label");
      if (label) {
        label.click();
        return true;
      }
      return true;
    }

    // 2. Any radio on page
    const allRadios = document.querySelectorAll("input[type='radio']");
    for (const radio of allRadios) {
      if (radio.closest("#amrita-automator-widget")) continue;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));

      if (radio.id) {
        const label = document.querySelector(`label[for='${radio.id}']`);
        if (label) {
          label.click();
          return true;
        }
      }
      return true;
    }

    // 3. Custom radio labels
    const optionLabels = document.querySelectorAll("label.form-check-label, .custom-radio-card, .option-card");
    if (optionLabels.length > 0) {
      for (const label of optionLabels) {
        if (label.closest("#amrita-automator-widget")) continue;
        label.click();
        return true;
      }
    }

    return false;
  }

  function findSubmitNextButton() {
    const allClickables = document.querySelectorAll("button, a, input[type='submit'], input[type='button'], .btn");
    let bestBtn = null;

    for (const b of allClickables) {
      if (b.closest("#amrita-automator-widget")) continue;
      if (!isVisible(b)) continue;

      const text = (b.textContent || b.value || "").trim().toLowerCase();
      const name = (b.getAttribute("name") || "").toLowerCase();

      // Skip navigation back/cancel/resend
      if (/back|prev|cancel|close|resend/i.test(text)) continue;

      // Class TLP button
      if (name === "submit_ans") return b;
      if (/save\s*[&]\s*next/i.test(text)) return b;

      // Course feedback "Next" button
      if (/^next$/i.test(text) || b.classList.contains("next-btn")) {
        if (!bestBtn) bestBtn = b;
        continue;
      }

      // Generic submit
      if (/submit/i.test(text) && !/feedback/i.test(text)) {
        if (!bestBtn) bestBtn = b;
        continue;
      }
    }

    return bestBtn;
  }

  function findButtonByText(regex) {
    const buttons = document.querySelectorAll("button, a, input[type='button'], input[type='submit'], .btn");
    for (const b of buttons) {
      if (b.closest("#amrita-automator-widget")) continue;
      const t = (b.textContent || b.value || "").trim();
      if (regex.test(t)) return b;
    }
    return null;
  }

  function findOtpInput() {
    const byPlaceholder = document.querySelector(
      "input[placeholder*='OTP' i], input[placeholder*='Email OTP' i], input[placeholder*='otp' i]"
    );
    if (byPlaceholder && !byPlaceholder.closest("#amrita-automator-widget")) return byPlaceholder;

    const allInputs = document.querySelectorAll("input[type='text'], input:not([type])");
    for (const inp of allInputs) {
      if (inp.closest("#amrita-automator-widget")) continue;
      if (inp.id === "aaw-manual-otp-input") continue;
      if (inp.type === "radio" || inp.type === "checkbox" || inp.type === "hidden" ||
          inp.type === "submit" || inp.type === "button") continue;

      const parent = inp.closest("div, form, section");
      if (parent) {
        const pText = parent.innerText || "";
        if (/otp|verification/i.test(pText)) return inp;
      }
    }

    for (const inp of allInputs) {
      if (inp.closest("#amrita-automator-widget")) continue;
      if (inp.id === "aaw-manual-otp-input") continue;
      if (inp.type === "radio" || inp.type === "checkbox" || inp.type === "hidden" ||
          inp.type === "submit" || inp.type === "button") continue;
      if (/search/i.test(inp.placeholder || "")) continue;
      if (isVisible(inp)) return inp;
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
      if (/ok|close|done|continue|confirm|yes/i.test((b.textContent || b.value || "").trim())) {
        b.click();
      }
    }
    const modalBtns = document.querySelectorAll(".modal.show button, .modal.show .close, .modal-footer button");
    for (const b of modalBtns) {
      if (/ok|close|done|continue|confirm|yes/i.test((b.textContent || b.value || "").trim())) {
        b.click();
      }
    }
  }

  function checkIfDone() {
    const text = (document.body.innerText || "").toLowerCase();

    if (isFinishScreen()) {
      handleFinishStep();
      return;
    }

    if (text.includes("thank you") || text.includes("submitted successfully") ||
        text.includes("feedback has been submitted") || text.includes("can not update feedback")) {
      log("✅ Feedback completed! Closing...");
      const finishBtn = findFinishButton();
      if (finishBtn) {
        handleFinishStep();
      } else {
        closeAndRefreshPortal();
      }
    } else {
      log("Waiting for page...");
      setTimeout(() => {
        if (isRunning) handleFeedbackForm();
      }, 1500);
    }
  }

  function closeAndRefreshPortal() {
    stopAutomation();
    // Keep auto-running flag active so the refreshed list continues with the next course
    localStorage.setItem("amrita_auto_running", "true");
    isRunning = true;

    chrome.runtime.sendMessage(
      { action: "CLOSE_AND_REFRESH_PORTAL", origin: originListPage },
      (res) => {
        if (chrome.runtime.lastError) {
          const listUrl = originListPage === "class-feedback"
            ? "https://students.amrita.edu/client/class-feedback"
            : "https://students.amrita.edu/client/course-feedback-list";
          window.location.href = listUrl;
        }
      }
    );
  }

  // ==========================================
  // FLOATING UI WIDGET
  // ==========================================
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
      <div class="aaw-header">
        <div class="aaw-title">⚡ Amrita Feedback Auto</div>
        <button class="aaw-btn-icon" id="aaw-min-btn" title="Minimize">−</button>
      </div>
      <div class="aaw-body">
        <div class="aaw-info-row">
          <span>Status:</span>
          <span class="aaw-status-badge idle" id="aaw-badge">READY</span>
        </div>
        <div class="aaw-log" id="aaw-log-box">${readyMsg}</div>
        <div class="aaw-actions">
          <button class="aaw-btn aaw-btn-start" id="aaw-start-btn">▶ Start Auto-Submit All</button>
          <button class="aaw-btn aaw-btn-stop" id="aaw-stop-btn" style="display:none;">⏸ Pause</button>
        </div>
        <button class="aaw-btn aaw-btn-check" id="aaw-check-outlook-btn">🔍 Fetch OTP from Outlook</button>
        <div class="aaw-manual-otp-group">
          <input type="text" class="aaw-input" id="aaw-manual-otp-input" placeholder="Manual OTP">
          <button class="aaw-btn aaw-btn-check" id="aaw-submit-manual-otp-btn">Submit OTP</button>
        </div>
        <div class="aaw-footer">Option 1 • TLP & Course Feedback • Auto-Finish Loop</div>
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
      widget.classList.toggle("minimized");
    });
    widget.addEventListener("click", (e) => {
      if (widget.classList.contains("minimized") && (e.target === widget || e.target.closest("#amrita-automator-widget") === widget)) {
        widget.classList.remove("minimized");
      }
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

    if (isRunning) {
      document.getElementById("aaw-start-btn").style.display = "none";
      document.getElementById("aaw-stop-btn").style.display = "flex";
    }
  }

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
    localStorage.setItem("amrita_auto_running", "false");
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
