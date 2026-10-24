# ⚡ Amrita Student Portal Feedback Automator

Automates the entire feedback submission process for Amrita Student Portal:
- Scans `https://students.amrita.edu/client/class-feedback` for uncompleted courses.
- Opens each course feedback form.
- Automatically selects the **1st option** for all **15 questions**.
- Clicks **Save & Next** on each question.
- On Question 16 (Finish):
  1. Clicks **SEND OTP**.
  2. Communicates with your open **Outlook Web** tab (`outlook.office.com`).
  3. Finds the latest OTP email from `Amrita Vishwa Vidyapeetham`.
  4. Extracts the verification OTP (e.g. `K2tER`).
  5. Inputs the OTP into the verification box and clicks **Validate & Finish**.
- Automatically loops through **all remaining courses** until 100% complete!

---

## 🚀 Quick Setup (Takes 15 seconds)

### Method 1: Chrome Extension (Recommended - Zero Setup)

1. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
2. Turn **ON** the **Developer mode** toggle in the top-right corner.
3. Click the **Load unpacked** button (top-left).
4. Select the folder:
   ```
   C:\Users\Ganesh\.gemini\antigravity\scratch\amrita-feedback-automation
   ```
5. Ensure you have two tabs open in Chrome:
   - **Tab 1:** `https://students.amrita.edu/client/class-feedback` (Logged in)
   - **Tab 2:** `https://outlook.office.com/mail/` (Logged in to your college email)
6. Refresh the Amrita portal tab. You will see a stylish **⚡ Amrita Feedback Auto** floating widget at the bottom right.
7. Click **▶ Start Auto-Submit** and watch it do everything automatically!

---

### Method 2: Tampermonkey Userscript

If you already use Tampermonkey:
1. Open Tampermonkey Dashboard -> **Create a new script**.
2. Copy and paste the contents of [`amrita_feedback.user.js`](./amrita_feedback.user.js).
3. Save the script (`Ctrl + S`).
4. Keep Outlook and Amrita open in Chrome, then click **Start Auto-Submit** on Amrita.

---

## 🛠 Features & Safeguards

- **Multi-Course Auto-Loop:** Loops through all pending courses in your table until every single course is marked *Completed*.
- **Smart Duplicate Prevention:** Keeps track of previous OTPs so it never re-submits an old code.
- **Manual Override:** If Outlook is delayed, you can type the OTP into the floating widget and click *Submit OTP*.
- **Real-time Status Log:** Displays live feedback progress (e.g., *Question 4/15: Selected option 1*, *Waiting for OTP...*, *Got OTP: K2tER*).
- **Pause & Resume:** Pause anytime with ⏸ *Pause* and resume when ready.
