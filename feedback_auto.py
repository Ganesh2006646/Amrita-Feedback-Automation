# -*- coding: utf-8 -*-
"""
Amrita Student Portal - Feedback Automator
============================================
Automatically submits feedback for ALL pending courses:
  - Selects Option 1 for all 15 questions
  - Clicks Save & Next
  - Handles OTP from Outlook
  - Loops through every subject

Run: python feedback_auto.py
"""

import time
import re
import sys
import subprocess
import os

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import (
        NoSuchElementException, TimeoutException,
        StaleElementReferenceException, ElementClickInterceptedException,
        WebDriverException
    )
except ImportError:
    print("[ERROR] Selenium not installed. Run: pip install selenium")
    sys.exit(1)

# --- CONFIG ---
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
USER_DATA = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data")
DEBUG_PORT = 9222
FEEDBACK_LIST_URL = "https://students.amrita.edu/client/class-feedback"


def kill_chrome():
    """Kill all Chrome processes."""
    print("    Closing all Chrome windows...")
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)


def launch_chrome_debug():
    """Launch Chrome with remote debugging port using existing user profile."""
    print("    Launching Chrome on debug port %d..." % DEBUG_PORT)
    cmd = [
        CHROME_PATH,
        "--remote-debugging-port=%d" % DEBUG_PORT,
        "--restore-last-session",
        "--user-data-dir=%s" % USER_DATA,
    ]
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(6)


def connect_selenium():
    """Attach Selenium to the running debuggable Chrome."""
    opts = Options()
    opts.add_experimental_option("debuggerAddress", "localhost:%d" % DEBUG_PORT)
    driver = webdriver.Chrome(options=opts)
    return driver


def js_click(driver, el):
    """Click element via JavaScript (bypasses overlays)."""
    driver.execute_script("arguments[0].click();", el)


def safe_click(driver, el):
    """Try normal click, fallback to JS click."""
    try:
        el.click()
    except (ElementClickInterceptedException, WebDriverException):
        js_click(driver, el)


def switch_to_tab(driver, url_fragment):
    """Switch to the tab whose URL contains the given fragment."""
    for handle in driver.window_handles:
        driver.switch_to.window(handle)
        if url_fragment in driver.current_url:
            return True
    return False


def wait_for_page_stable(driver, seconds=2):
    """Wait for the page to settle."""
    time.sleep(seconds)


# ==================================================
# STEP HANDLERS
# ==================================================

def go_to_feedback_list(driver):
    """Navigate to the class-feedback page."""
    switch_to_tab(driver, "students.amrita.edu")
    if "/class-feedback" not in driver.current_url:
        driver.get(FEEDBACK_LIST_URL)
    wait_for_page_stable(driver, 3)


def find_pending_course(driver):
    """
    Find the first 'Submit Feedback' button in the table.
    Returns (button_element, course_name) or (None, None).
    """
    wait_for_page_stable(driver, 2)

    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.TAG_NAME, "table"))
        )
    except TimeoutException:
        return None, None

    rows = driver.find_elements(By.CSS_SELECTOR, "table tr")
    for row in rows:
        try:
            text = row.text
        except StaleElementReferenceException:
            continue

        if "Completed" in text or "View Feedback" in text:
            continue

        links = row.find_elements(By.CSS_SELECTOR, "button, a")
        for link in links:
            try:
                lt = link.text.strip()
            except StaleElementReferenceException:
                continue
            if re.search(r"Submit\s*Feedback", lt, re.IGNORECASE):
                cells = row.find_elements(By.TAG_NAME, "td")
                name = ""
                if len(cells) >= 4:
                    name = cells[2].text.strip()
                return link, name

    return None, None


def answer_question(driver):
    """Select option 1 for the current question."""

    # --- Try radio buttons ---
    radios = driver.find_elements(By.CSS_SELECTOR, 'input[type="radio"]')
    if radios:
        try:
            js_click(driver, radios[0])
            parent = radios[0].find_element(By.XPATH, "./..")
            js_click(driver, parent)
        except Exception:
            pass
        return True

    # --- Try text like "1) ..." ---
    all_elements = driver.find_elements(By.XPATH,
        "//*[self::div or self::span or self::label or self::li or self::p]")
    for el in all_elements:
        try:
            txt = el.text.strip()
            if not txt:
                continue
            if re.match(r"^1\s*[\)\.\-\:]", txt) and len(txt) < 150:
                if el.is_displayed():
                    safe_click(driver, el)
                    return True
        except (StaleElementReferenceException, WebDriverException):
            continue

    # --- Try role=radio or option class ---
    opts = driver.find_elements(By.CSS_SELECTOR,
        "[role='radio'], [class*='option'], [class*='choice'], [class*='answer']")
    if opts:
        safe_click(driver, opts[0])
        return True

    return False


def click_next_button(driver):
    """Click 'Save & Next' or similar button."""
    buttons = driver.find_elements(By.CSS_SELECTOR, "button")
    for btn in buttons:
        try:
            t = btn.text.strip().lower()
        except (StaleElementReferenceException, WebDriverException):
            continue
        if ("save" in t and "next" in t) or t in ("save & next", "save &amp; next"):
            safe_click(driver, btn)
            return True

    # Broader search
    for btn in buttons:
        try:
            t = btn.text.strip().lower()
        except (StaleElementReferenceException, WebDriverException):
            continue
        if "save" in t or "next" in t:
            safe_click(driver, btn)
            return True

    return False


def is_finish_page(driver):
    """Check if we are on the FINISH / OTP page (question 16)."""
    try:
        body = driver.find_element(By.TAG_NAME, "body").text
    except Exception:
        return False

    if "FINISH" in body and ("SEND OTP" in body or "Validate" in body or "verify otp" in body.lower()):
        return True

    btns = driver.find_elements(By.CSS_SELECTOR, "button")
    for btn in btns:
        try:
            bt = btn.text.strip()
            if re.search(r"SEND\s*OTP|Validate\s*&?\s*Finish", bt, re.IGNORECASE):
                return True
        except (StaleElementReferenceException, WebDriverException):
            continue

    return False


def do_15_questions(driver):
    """Answer all 15 questions."""
    for q_idx in range(1, 20):
        wait_for_page_stable(driver, 1.2)

        if is_finish_page(driver):
            print("    [OK] All 15 questions answered!")
            return True

        # Detect question number
        try:
            body = driver.find_element(By.TAG_NAME, "body").text
            m = re.search(r"QUESTION\s*[-\u2013:]\s*(\d+)", body, re.IGNORECASE)
            qn = m.group(1) if m else str(q_idx)
        except Exception:
            qn = str(q_idx)

        sys.stdout.write("    Q%s: Option 1" % qn)

        ok = answer_question(driver)
        if ok:
            sys.stdout.write(" [selected]")
        else:
            time.sleep(0.5)
            answer_question(driver)
            sys.stdout.write(" [retry]")

        time.sleep(0.5)

        clicked = click_next_button(driver)
        if clicked:
            print(" -> Saved & Next")
        else:
            time.sleep(0.5)
            click_next_button(driver)
            print(" -> Saved (retry)")

        time.sleep(1)

    return is_finish_page(driver)


def handle_otp_flow(driver, last_otp):
    """Click SEND OTP, read from Outlook, enter and validate."""
    wait_for_page_stable(driver, 1)

    # Click SEND OTP
    btns = driver.find_elements(By.CSS_SELECTOR, "button")
    for btn in btns:
        try:
            if re.search(r"SEND\s*OTP", btn.text.strip(), re.IGNORECASE):
                print("       -> Clicking 'SEND OTP'...")
                safe_click(driver, btn)
                time.sleep(3)
                break
        except (StaleElementReferenceException, WebDriverException):
            continue

    amrita_handle = driver.current_window_handle

    # Switch to Outlook
    otp = None
    found_outlook = switch_to_tab(driver, "outlook")
    if found_outlook:
        print("       -> Reading OTP from Outlook...")
        otp = read_otp_from_outlook(driver, last_otp)

    if otp:
        print("       -> [OK] Got OTP: %s" % otp)
    else:
        print("       -> [!] Could not auto-read OTP from Outlook.")
        otp = input("       -> TYPE THE OTP HERE AND PRESS ENTER: ").strip()

    # Switch back to Amrita
    driver.switch_to.window(amrita_handle)
    time.sleep(1)

    # Enter OTP
    inputs = driver.find_elements(By.CSS_SELECTOR, "input[type='text']")
    if not inputs:
        inputs = driver.find_elements(By.CSS_SELECTOR,
            "input:not([type='button']):not([type='submit']):not([type='hidden']):not([type='radio']):not([type='checkbox'])")

    otp_input = None
    for inp in inputs:
        try:
            if inp.is_displayed() and inp.is_enabled():
                otp_input = inp
                break
        except (StaleElementReferenceException, WebDriverException):
            continue

    if otp_input:
        print("       -> Entering OTP: %s" % otp)
        otp_input.click()
        otp_input.clear()
        time.sleep(0.2)
        otp_input.send_keys(otp)
        time.sleep(0.5)
    else:
        print("       -> [ERROR] Could not find OTP input field!")
        return last_otp

    # Click Validate & Finish
    btns = driver.find_elements(By.CSS_SELECTOR, "button")
    for btn in btns:
        try:
            bt = btn.text.strip()
            if re.search(r"Validate\s*&?\s*Finish", bt, re.IGNORECASE):
                print("       -> Clicking 'Validate & Finish'...")
                safe_click(driver, btn)
                time.sleep(4)
                break
        except (StaleElementReferenceException, WebDriverException):
            continue

    # Dismiss popups
    time.sleep(1)
    dismiss_popups(driver)

    return otp


def read_otp_from_outlook(driver, last_otp):
    """Poll Outlook page for latest OTP email."""
    for attempt in range(25):
        try:
            items = driver.find_elements(By.CSS_SELECTOR,
                'div[role="option"], div[role="listitem"]')
            for item in items:
                try:
                    itxt = item.text
                    if "OTP for Student Portal" in itxt or "Amrita Vishwa" in itxt:
                        safe_click(driver, item)
                        time.sleep(1.2)
                        break
                except (StaleElementReferenceException, WebDriverException):
                    continue

            body = driver.find_element(By.TAG_NAME, "body").text
            m = re.search(
                r"OTP for Student Feedback Verification is\s*([A-Za-z0-9]{4,8})",
                body, re.IGNORECASE)
            if not m:
                m = re.search(r"Verification is\s*([A-Za-z0-9]{4,8})", body, re.IGNORECASE)

            if m:
                code = m.group(1).strip()
                if code != last_otp:
                    return code

        except Exception:
            pass

        time.sleep(2)

    return None


def dismiss_popups(driver):
    """Click OK / Close on any popup."""
    try:
        alert = driver.switch_to.alert
        alert.accept()
        return
    except Exception:
        pass

    btns = driver.find_elements(By.CSS_SELECTOR,
        ".swal2-confirm, .swal-button, [class*='dialog'] button, [class*='modal'] button, button")
    for b in btns:
        try:
            t = b.text.strip().lower()
            if t in ("ok", "close", "done", "confirm", "continue", "yes"):
                safe_click(driver, b)
                time.sleep(0.5)
                return
        except Exception:
            continue


# ==================================================
# MAIN
# ==================================================

def main():
    print()
    print("=" * 56)
    print("   Amrita Feedback Automator")
    print("=" * 56)

    # Step 1: Restart Chrome with debugging
    print("\n[Step 1] Preparing Chrome...")
    kill_chrome()
    launch_chrome_debug()

    print()
    print("+------------------------------------------------------+")
    print("|  Chrome is now open.                                  |")
    print("|                                                       |")
    print("|  Make sure you have TWO tabs open:                    |")
    print("|    1. students.amrita.edu/client/class-feedback       |")
    print("|    2. outlook.office.com/mail                         |")
    print("|                                                       |")
    print("|  Both must be LOGGED IN.                              |")
    print("+------------------------------------------------------+")
    input("\n  >> Press ENTER when both tabs are ready... ")

    # Step 2: Connect Selenium
    print("\n[Step 2] Connecting to Chrome...")
    try:
        driver = connect_selenium()
        print("    [OK] Connected! Tabs open: %d" % len(driver.window_handles))
    except Exception as e:
        print("\n    [ERROR] Failed to connect: %s" % str(e))
        print("    Make sure Chrome opened correctly and try again.")
        input("Press ENTER to close...")
        sys.exit(1)

    # Step 3: Go to feedback list
    print("\n[Step 3] Going to Class Feedback page...")
    go_to_feedback_list(driver)

    # Step 4: Loop through all courses
    print("\n[Step 4] Processing all courses...\n")

    last_otp = ""
    done_count = 0

    while True:
        go_to_feedback_list(driver)

        btn, course_name = find_pending_course(driver)

        if btn is None:
            print()
            print("=" * 56)
            print("  ALL DONE! Submitted %d course(s)." % done_count)
            print("=" * 56)
            break

        done_count += 1
        print("------------------------------------------------------")
        print("  Course %d: %s" % (done_count, course_name))
        print("------------------------------------------------------")

        # Click Submit Feedback
        print("    -> Opening feedback form...")
        safe_click(driver, btn)
        wait_for_page_stable(driver, 2.5)

        # Answer 15 questions
        ok = do_15_questions(driver)

        if not ok:
            print("    [!] Could not reach finish page. Skipping.")
            continue

        # Handle OTP
        print("\n    OTP verification:")
        last_otp = handle_otp_flow(driver, last_otp)

        print("    [OK] '%s' -- SUBMITTED!" % course_name)
        print()
        time.sleep(2)

    print("\nScript finished. You can close this window.\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nStopped by user.")
    except Exception as e:
        print("\n[ERROR] Unexpected error: %s" % str(e))
        import traceback
        traceback.print_exc()
        print("\nPlease share the error above so I can fix it.")
        input("Press ENTER to close...")
