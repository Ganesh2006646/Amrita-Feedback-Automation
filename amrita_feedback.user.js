// ==UserScript==
// @name         Amrita Student Feedback Automator
// @namespace    https://students.amrita.edu/
// @version      1.0
// @description  Automates Amrita class feedback forms, chooses option 1 for all 15 questions, requests OTP, reads OTP from Outlook tab, and submits.
// @author       Antigravity
// @match        https://students.amrita.edu/*
// @match        https://outlook.office.com/*
// @match        https://outlook.live.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const isOutlook = location.hostname.includes('outlook');
  const isAmrita = location.hostname.includes('students.amrita.edu');

  // ========================================================
  // OUTLOOK LISTENER LOGIC
  // ========================================================
  if (isOutlook) {
    console.log('[Amrita Automator - Userscript] Outlook watcher running.');

    // Listen for OTP requests from the Amrita tab
    GM_addValueChangeListener('amrita_otp_request', async function (name, oldVal, newVal, remote) {
      if (!newVal || !remote) return;
      console.log('[Amrita Automator] Received OTP request timestamp:', newVal);

      const lastUsedOtp = GM_getValue('amrita_last_used_otp', '');
      const otp = await pollOutlookForOtp(lastUsedOtp);

      if (otp) {
        console.log('[Amrita Automator] Found new OTP:', otp);
        GM_setValue('amrita_latest_otp', { otp: otp, timestamp: Date.now() });
      }
    });

    async function pollOutlookForOtp(lastOtp) {
      for (let i = 0; i < 35; i++) {
        // Try clicking topmost feedback email
        clickLatestFeedbackEmail();
        await new Promise(r => setTimeout(r, 600));

        const body = document.body.innerText || '';
        const match = body.match(/OTP for Student Feedback Verification is\s*([A-Za-z0-9]{4,8})/i) ||
                      body.match(/Verification is\s*([A-Za-z0-9]{4,8})/i);

        if (match && match[1]) {
          const code = match[1].trim();
          if (!lastOtp || code !== lastOtp) {
            return code;
          }
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      return null;
    }

    function clickLatestFeedbackEmail() {
      const candidates = Array.from(document.querySelectorAll('div[role="option"], div[role="listitem"], [data-convid], div, span')).filter(el => {
        const txt = el.textContent || '';
        return (txt.includes('OTP for Student Portal') || txt.includes('Amrita Vishwa Vidyapeetham')) &&
               txt.length < 200 && el.offsetParent !== null;
      });

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const top = candidates[0].closest('div[role="option"], div[role="listitem"]') || candidates[0];
        top.click();
      }
    }
    return;
  }

  // ========================================================
  // AMRITA PORTAL AUTOMATION LOGIC
  // ========================================================
  if (isAmrita) {
    console.log('[Amrita Automator - Userscript] Amrita script loaded.');

    let isRunning = GM_getValue('amrita_auto_active', false);
    let delayMs = 450;

    // Build Floating UI
    const widget = document.createElement('div');
    widget.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; width: 320px;
      background: white; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      z-index: 999999; font-family: sans-serif; border: 1px solid #cbd5e1; overflow: hidden;
    `;
    widget.innerHTML = `
      <div style="background: linear-gradient(135deg, #be123c, #e11d48); color: white; padding: 10px 14px; font-weight: bold; font-size: 13px; display: flex; justify-content: space-between;">
        <span>⚡ Amrita Feedback Auto</span>
        <button id="us-min-btn" style="background:none; border:none; color:white; cursor:pointer;">−</button>
      </div>
      <div id="us-body" style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div id="us-log" style="background: #0f172a; color: #38bdf8; padding: 8px; border-radius: 6px; font-size: 11px; min-height: 40px; font-family: monospace;">
          ${isRunning ? 'Resuming auto-submit...' : 'Ready. Click Start to begin.'}
        </div>
        <div style="display:flex; gap: 6px;">
          <button id="us-start-btn" style="flex:1; padding: 8px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
            ▶ Start Auto-Submit
          </button>
          <button id="us-stop-btn" style="flex:1; padding: 8px; background: #ef4444; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; display: ${isRunning ? 'block' : 'none'};">
            ⏸ Pause
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(widget);

    const logBox = document.getElementById('us-log');
    const startBtn = document.getElementById('us-start-btn');
    const stopBtn = document.getElementById('us-stop-btn');
    const minBtn = document.getElementById('us-min-btn');
    const usBody = document.getElementById('us-body');

    function log(msg) {
      console.log('[Amrita Automator]', msg);
      if (logBox) logBox.innerText = msg;
    }

    minBtn.onclick = () => {
      usBody.style.display = usBody.style.display === 'none' ? 'flex' : 'none';
    };

    startBtn.onclick = () => {
      isRunning = true;
      GM_setValue('amrita_auto_active', true);
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      log('Started! Running...');
      step();
    };

    stopBtn.onclick = () => {
      isRunning = false;
      GM_setValue('amrita_auto_active', false);
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      log('Paused.');
    };

    if (isRunning) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      setTimeout(step, 1500);
    }

    async function step() {
      if (!isRunning) return;

      if (location.pathname.includes('/class-feedback')) {
        log('Checking for pending courses...');
        let submitBtn = null;
        for (let i = 0; i < 15; i++) {
          const rows = Array.from(document.querySelectorAll('table tbody tr, tr'));
          for (const row of rows) {
            const btn = Array.from(row.querySelectorAll('button, a')).find(b => /submit\s*feedback/i.test(b.textContent.trim()));
            if (btn && !row.innerText.toLowerCase().includes('completed')) {
              submitBtn = btn;
              break;
            }
          }
          if (submitBtn) break;
          await new Promise(r => setTimeout(r, 500));
        }

        if (submitBtn) {
          log('Opening next course...');
          await new Promise(r => setTimeout(r, 600));
          submitBtn.click();
        } else {
          log('🎉 All courses completed!');
          GM_setValue('amrita_auto_active', false);
          startBtn.style.display = 'block';
          stopBtn.style.display = 'none';
        }
      } else if (location.pathname.includes('/feedback')) {
        // Questions or finish
        if (isFinish()) {
          await handleFinish();
        } else {
          // Select 1st option
          log('Selecting Option 1...');
          selectFirst();
          await new Promise(r => setTimeout(r, delayMs));

          // Click Save & Next
          const nextBtn = Array.from(document.querySelectorAll('button, a')).find(b => {
            const t = b.textContent.trim().toLowerCase();
            return t.includes('save') || t.includes('next') || t.includes('submit');
          });
          if (nextBtn) nextBtn.click();
          setTimeout(step, 900);
        }
      }
    }

    function isFinish() {
      const txt = document.body.innerText || '';
      return /16\s*FINISH/i.test(txt) || /verify OTP/i.test(txt) ||
             Array.from(document.querySelectorAll('button')).some(b => /send\s*otp|validate\s*&\s*finish/i.test(b.textContent));
    }

    function selectFirst() {
      const radios = document.querySelectorAll('input[type="radio"]');
      if (radios.length > 0) {
        radios[0].checked = true;
        radios[0].click();
        radios[0].dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const candidates = Array.from(document.querySelectorAll('div, label, li, span')).filter(el => {
        const t = (el.innerText || el.textContent || '').trim();
        return /^1\s*[\)\.\-]/i.test(t) && t.length < 120 && el.children.length <= 1;
      });
      if (candidates.length > 0) {
        const target = candidates[0].closest('div, label, li') || candidates[0];
        target.click();
      }
    }

    async function handleFinish() {
      log('Handling OTP verification...');
      const sendOtp = Array.from(document.querySelectorAll('button')).find(b => /send\s*otp/i.test(b.textContent));
      if (sendOtp) {
        log('Clicking SEND OTP...');
        sendOtp.click();
        await new Promise(r => setTimeout(r, 1500));
      }

      log('Waiting for OTP from Outlook tab...');
      const reqId = Date.now();
      GM_setValue('amrita_otp_request', reqId);

      // Listen for latest OTP
      const unlisten = GM_addValueChangeListener('amrita_latest_otp', async (name, oldV, newV, remote) => {
        if (!newV || !newV.otp) return;
        unlisten();
        const code = newV.otp;
        log(`Got OTP: ${code}! Submitting...`);
        GM_setValue('amrita_last_used_otp', code);

        const input = document.querySelector('input[type="text"], input:not([type="button"]):not([type="submit"]):not([type="hidden"])');
        if (input) {
          input.focus();
          input.value = code;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 500));
        const valBtn = Array.from(document.querySelectorAll('button')).find(b => /validate\s*&\s*finish/i.test(b.textContent));
        if (valBtn) valBtn.click();

        await new Promise(r => setTimeout(r, 3500));
        // Redirect back to list
        location.href = 'https://students.amrita.edu/client/class-feedback';
      });
    }
  }
})();
