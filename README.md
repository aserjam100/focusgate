# FocusGate

A Chrome extension (Manifest V3) that blocks distracting sites on a schedule. Unlocking takes deliberate effort: a code from your accountability partner, a spoken end-of-day review, or typing a humbling phrase.

Plain JavaScript, HTML and CSS. No build step.

## Features

- **Scheduled blocking.** Uses `declarativeNetRequest` dynamic rules, with a global schedule and optional per-site schedules. Each weekday can have its own windows, and windows may cross midnight (e.g. Fri 22:00–02:00). Blocking covers subdomains (`old.reddit.com`, `m.youtube.com`, …). Blocked pages redirect to a block page that shows the site, your goals for the day, a countdown to the end of the window, and the unlock options.
- **Gated settings.** During a block window, anything that loosens blocking needs an unlock: unchecking or deleting a site, changing its mode or schedule, turning grayscale off, editing the global schedule or requirements, or pausing. Changes that tighten blocking (adding a site, enabling one, turning on grayscale) always work.
- **Temporary unlocks.** They last 15 minutes by default and relock automatically via `chrome.alarms`. While one is running, the extension badge shows a countdown. Any tab that is still open on the site is sent back to the block page when it relocks.
- **Voice day review.** Speak a review of your day on a full extension tab (Web Speech API, continuous, with live interim text). It must meet a minimum speaking time and word count. If you add a Claude API key, Claude also judges the review against your goals. It is only available after a configured time (default 17:00). Passing unlocks everything until midnight. Every transcript is saved to a history log.
- **Accountability partner.** Your partner gets an email with a 6-digit code, the site you want, and your reason. Only a salted hash of the code is stored, with a 30-minute expiry. You get 3 requests per day, 5 wrong guesses kill a code, and a partner code can also unlock *settings*.
- **Grayscale.** Per-site `filter: grayscale(100%)` during block windows. It works alongside blocking or on its own ("No block" mode). To turn it off until the window ends, you must type a phrase exactly. Paste, drop, autocomplete and autocorrect are all blocked on that input.
- **Stats.** A local dashboard showing time per site per day, unlock attempts and successes per method, and your current and longest streak (days with no unlock during a block window).

## Install (load unpacked)

1. Download or clone this folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `focusgate` folder (the one containing `manifest.json`).
4. The settings page opens. Pin FocusGate from the puzzle-piece menu so the badge countdown is visible.

On first install you get a **30-minute setup grace period** with settings unlocked, even if a block window is active. Use it to set your goals, schedule and partner. After that the normal rules apply.

Requires Chrome 116 or later.

## Partner email backend (Google Apps Script, ~5 minutes)

An extension can't send email by itself. FocusGate POSTs the code to a small Google Apps Script web app, which emails your partner from **your own Gmail** via `MailApp`. You don't need a domain, API keys, or any account besides Google.

1. Go to <https://script.google.com> and create a **New project**. Name it `FocusGate mailer`.
2. Replace the contents of `Code.gs` with [`backend/apps-script/Code.gs`](backend/apps-script/Code.gs).
3. Open **Project Settings** (gear icon) → **Script properties** and add:
   | Property | Value |
   |---|---|
   | `SHARED_SECRET` | A long random string, e.g. the output of `openssl rand -hex 24`. Required. |
   | `PARTNER_EMAIL` | Your partner's email address. Recommended: codes then *always* go here, whatever the extension sends, so changing the address in the extension can't redirect codes to you. |
   | `MAX_PER_DAY` | Optional server-side daily cap (default `3`). |
4. In the editor, select `testSend` and click **Run**. Approve the Gmail permission prompt. You'll get a test email.
5. Click **Deploy → New deployment**, choose type **Web app**, and set:
   - Execute as: **Me**
   - Who has access: **Anyone** (the shared secret is what protects it)
6. Copy the **Web app URL** (it ends in `/exec`).
7. In FocusGate settings → **Accountability partner**, set:
   - **Email backend:** `Google Apps Script`
   - **Backend URL:** the `/exec` URL
   - **Backend shared secret:** the same `SHARED_SECRET`
   - Your partner's name and email

   Then click **Save settings**.

To check it's live, open the `/exec` URL in a browser. You should see `{"ok":true,"service":"focusgate-mailer"}`.

If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

Gmail's free `MailApp` quota is about 100 emails a day, far more than needed here.

**Other providers.** Senders live in `src/lib/email.js` (`SENDERS`). The `webhook` sender POSTs the same JSON with an `Authorization: Bearer <secret>` header, so a Cloudflare Worker using Resend, Postmark, etc. also works. Note that Resend only delivers to arbitrary recipients from a domain you have verified.

## Claude check for the day review (optional)

Paste an Anthropic API key into Settings → Day review. After you pass the time and word-count requirements, the service worker sends your transcript and goals to the Messages API (`claude-opus-5` by default; the model is editable). It requests structured output (`{"approved": bool, "reason": string}`) and shows you the reason. If the API call fails, the unlock is **not** granted. Without a key, only time and word count are checked.

## Using it

- **Popup:** quick toggles, add/remove sites, pause/resume, and links to settings, stats and the day review. A "color…" link appears next to sites that are currently grayscale.
- **Settings page:** sites (mode, grayscale, global or custom schedule), global schedule (with presets), goals, unlock duration, day-review requirements, partner, grayscale phrase.
- **Unlock settings during a block window:** click **Unlock settings…** on the settings page or in the popup. It opens the block page in "settings" mode, where a partner code unlocks settings for the unlock duration. A passed day review also frees settings for the rest of the day.

## Development

```sh
npm install              # Playwright (tests only)
npx playwright install chromium
npm test                 # unit tests (schedule math, gating, crypto, stats, LLM/email shapes, Apps Script)
npm run test:e2e         # loads the unpacked extension into Chromium and drives it
node tests/e2e/screens.mjs /tmp/shots   # screenshots of every page
```

The E2E suite covers real DNR redirects (including subdomains and preserving the original URL), gating, alarm-driven relock, browser restart mid-unlock, redirecting open tabs, the voice review (with a fake `SpeechRecognition`), the Claude check (with a stubbed `fetch`), the full partner flow against a local fake backend, grayscale and the phrase input, heartbeat time tracking, and the dashboard. Schedule tests also pass under `TZ=America/New_York`, `Asia/Kolkata` and `Pacific/Auckland`.

### Layout

```
manifest.json
src/background/sw.js      service worker: single writer of settings/state; recompute, rules, alarms, badge, messages
src/lib/                  pure logic shared by worker and pages (schedule, status/gating, rules, crypto, stats, email, llm)
src/content/core.js       grayscale + time-tracking heartbeat (registered dynamically for configured sites)
src/popup/  src/options/  src/block/  src/review/  src/phrase/  src/stats/
backend/apps-script/Code.gs
tests/unit/  tests/e2e/
```

## How it handles the edge cases

- **Browser restart mid-unlock.** Unlocks are stored as absolute timestamps. On startup and on every service-worker wake, the worker recomputes status, prunes expired unlocks and re-arms the alarm, so an unlock that expired while Chrome was closed is simply gone.
- **Schedules crossing midnight.** A window whose end is at or before its start runs into the next day. Adjacent windows (Mon 22:00–24:00 + Tue 00:00–06:00) merge, so the countdown shows the real end time.
- **Timezone changes and DST.** Schedules are wall-clock times in the *current* system timezone, recomputed from scratch each time. Besides an exact alarm at the next transition, a 1-minute `fg-tick` alarm recomputes, which catches timezone changes, clock changes and sleep/wake.
- **Extension updated while a block is active.** Dynamic DNR rules and registered content scripts persist across updates. `onInstalled` fills in any new settings keys, recomputes, and re-injects the content script into already-open tabs; the orphaned old instance tears itself down.
- **Tabs open when a block starts.** DNR only affects new requests, so the worker also redirects matching open tabs to the block page.
- **Sites with a service worker (x.com and other PWAs) and Back/Forward.** `declarativeNetRequest` only sees real network requests. A navigation the site's own service worker answers from cache, or a page restored from the back/forward cache, never hits the network, so the redirect rule can't fire. Two backup layers catch these: the worker watches `tabs.onUpdated` and redirects any tab that lands on a blocked domain, and the content script (which runs at `document_start` on configured sites) redirects itself if its site is blocked.

## Chrome limitations (and what FocusGate does about them)

These are stated plainly rather than papered over.

1. **You can always disable or remove the extension** at `chrome://extensions`. No extension can prevent this. Incognito windows aren't covered unless you enable "Allow in Incognito", and other browsers or profiles aren't covered at all.
2. **Local state can be edited.** Anyone can open DevTools on an extension page and write to `chrome.storage.local`. Gating is enforced in the service worker (the UI can't bypass it), but it's friction, not security. The partner code hash uses **PBKDF2-SHA-256 with a random salt and 2M iterations** rather than a single SHA-256. With only 10⁶ possible codes, a plain hash can be brute-forced in under a second; at ~0.16 s per guess, the full search takes hours even across all CPU cores. The code expires in 30 minutes. For real tamper resistance the server would have to verify the code, which this design deliberately doesn't do.
3. **`declarativeNetRequest` redirects to an extension page** require `host_permissions` for the blocked URLs, and you can add any site. That's why the extension asks for `<all_urls>`. The same permission lets it register the grayscale and time-tracking content script on your configured sites only.
4. **Speech recognition is Google's cloud service.** `webkitSpeechRecognition` sends audio to Google and needs an internet connection. Chrome also ends "continuous" sessions after silence or about a minute; FocusGate restarts them automatically while you're recording. It runs in a full tab because popups close when they lose focus and can't reliably hold a microphone permission prompt. If you deny the mic, the page tells you how to re-allow it (address-bar mic icon or `chrome://settings/content/microphone`). Speaking time counts only while recognition results are arriving, so staying silent doesn't count.
5. **Alarm timing.** Packed extensions have a 30-second minimum alarm period, and alarms can fire late after the machine sleeps. The 1-minute recompute tick keeps state correct within about a minute of any boundary.
6. **The Claude API key is stored unencrypted** in `chrome.storage.local`, and calling the API from the browser requires the `anthropic-dangerous-direct-browser-access` header. Use a key with a spending limit.
7. **Time tracking is approximate.** A tracked site's tab reports 15-second heartbeats while it is visible, focused, and Chrome's `idle` API says you've been active in the last 60 seconds. Background audio and video aren't counted.
8. **Streaks count days with no data as clean,** including days the browser was never opened.
