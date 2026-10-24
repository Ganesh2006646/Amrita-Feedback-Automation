# ⚡ Amrita Student Portal Feedback Automator (v2.0.0)

A fast, automated Chrome extension that completes student feedback submissions on `students.amrita.edu` with full OTP verification from Outlook and automatic course looping.

---

## 🌟 Supported Feedback Types

1. **Course Feedback (`/client/course-feedback-list`)**:
   - Detects all pending courses in the table.
   - Automatically opens course feedback form.
   - Triggers **SEND OTP** (which comes first in Course Feedback).
   - Reads the latest verification OTP directly from your active Outlook tab (`outlook.cloud.microsoft` / `outlook.office.com`).
   - Validates OTP and automatically proceeds to answer all 5 questions with **Option 1**.
   - Clicks **Finish**, auto-confirms the submission dialog ("OK"), closes the tab, and refreshes the course list to start the next course!

2. **Class TLP Feedback (`/client/class-feedback`)**:
   - Automatically opens each pending course.
   - Selects **Option 1** for all 15 questions and clicks **Save & Next**.
   - On Step 16 (FINISH), triggers **SEND OTP**, reads OTP from Outlook, validates, and loops to the next course!

---

## 🚀 Installation Guide

### Option A: From Pre-built ZIP
1. Download **`Amrita-Feedback-Automator-v2.0.0.zip`**.
2. Right-click and choose **Extract All...** to a folder on your computer.
3. Open Chrome and go to `chrome://extensions`.
4. Turn **ON** the **Developer mode** toggle in the top-right corner.
5. Click **Load unpacked** (top-left) and select the extracted folder.

### Option B: From Source Directory
1. Open Chrome and go to `chrome://extensions`.
2. Turn **ON** **Developer mode**.
3. Click **Load unpacked** and select:
   ```
   C:\Users\Ganesh\OneDrive\Desktop\Amrita-Feedback-Automation
   ```

---

## 📋 How to Use

1. Ensure **two tabs** are open in the same Chrome window:
   - **Tab 1:** `https://students.amrita.edu/client/course-feedback-list` (or `/client/class-feedback`)
   - **Tab 2:** Your Amrita Outlook Web mail (`outlook.cloud.microsoft` or `outlook.office.com`)
2. On the Amrita portal tab, you will see the floating **⚡ Amrita Feedback Auto** widget at the bottom right.
3. Click **▶ Start Auto-Submit All**.
4. Sit back and watch it complete and submit all courses automatically!
