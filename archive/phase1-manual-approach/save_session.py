"""
One-time session capture for the meeting bot.

Google Meet no longer allows fully anonymous, signed-out guests to join
calls, so the bot must join while signed into a Google account. Rather than
have the bot automate a login (which would require handling a password),
this script opens a real, visible browser, waits for a human to log in by
hand, and then saves the resulting session (cookies/local storage) to
bot/auth_state.json via Playwright's storage_state() feature.

auth_state.json grants access to whatever Google account was used to log in
here. It is sensitive credential-equivalent data:
  - NEVER commit it to git (it is already listed in .gitignore).
  - NEVER share it, upload it, or paste its contents anywhere.
  - Treat it like a password: anyone with this file can act as that account.

This script never sees, requests, stores, or logs a password. It only opens
a browser window and waits for you to finish logging in yourself.

Usage:
    python save_session.py
"""

from playwright.sync_api import sync_playwright

AUTH_STATE_PATH = "auth_state.json"


def run() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False, channel="chrome")
        context = browser.new_context()
        page = context.new_page()

        page.goto("https://accounts.google.com/signin", wait_until="domcontentloaded", timeout=30_000)

        print()
        print("A browser window has opened to the Google sign-in page.")
        print("Log in manually using the DEDICATED bot Google account")
        print("(not your personal account). Complete any 2FA/verification")
        print("steps if prompted, until you can see the account's inbox or")
        print("account page.")
        print()
        input("Press Enter in this terminal once you have successfully logged in: ")

        context.storage_state(path=AUTH_STATE_PATH)

        print()
        print(f"Session saved to {AUTH_STATE_PATH}.")
        print("This file grants access to the signed-in Google account.")
        print("Do NOT commit it to git or share it with anyone.")
        print()

        context.close()
        browser.close()


if __name__ == "__main__":
    run()
