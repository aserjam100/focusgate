# FocusGate

A Chrome extension that puts a gate in front of the sites you reach for on autopilot (Instagram, YouTube, LinkedIn, X, Reddit, or anything you add).

During the hours you choose, those sites show a block page with your goal instead. You can still get through, but only with some effort:

- **Ask a friend** for an unlock code (optional, needs a 5-minute setup).
- **Say out loud what you did today** in the evening, and everything unlocks until midnight.
- For sites in **grayscale**, type a humbling sentence word for word to bring the colour back.

Settings are locked during block windows, so you can't switch it off in a weak moment.

**Private by default.** Everything is stored in your own browser. Speech is transcribed on your device. There are no accounts, analytics or trackers, and no servers of ours. See [Privacy](#privacy).

---

## Install

FocusGate isn't on the Chrome Web Store; you load it yourself. It takes about a minute.

**1. Download it**

- **Easiest:** on this GitHub page, click the green **Code** button, then **Download ZIP**. Unzip it somewhere you'll keep it (e.g. `Documents/focusgate`). Chrome loads the extension from that folder, so don't delete it afterwards.
- **Or with git:**
  ```sh
  git clone https://github.com/<your-username>/focusgate.git
  ```

**2. Load it into Chrome**

1. Open `chrome://extensions` in the address bar.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `focusgate` folder, the one that contains `manifest.json`. (If you unzipped a GitHub download, it may be called `focusgate-main`.)
4. The FocusGate settings page opens automatically.
5. Click the puzzle-piece icon in Chrome's toolbar and **pin** FocusGate. The icon shows a countdown while something is unlocked.

Use an up-to-date desktop Chrome; the voice review relies on Chrome's recent on-device speech recognition. Other Chromium-based browsers may work but aren't tested.

**3. Set it up (you have 30 minutes)**

Right after installing, settings stay unlocked for **30 minutes** even if you're inside a block window. Use that time to:

- **write your goal** (required, and you can change it any time later),
- adjust the sites and the schedule,
- optionally set up an accountability partner (see below).

After that, the lock rules apply.

**Updating:** download the new version into the same folder (or `git pull`), then click the ↻ reload icon on FocusGate's card in `chrome://extensions`. Your settings and history are kept.

**Uninstalling:** click **Remove** on the card in `chrome://extensions`. This deletes all FocusGate data from the browser.

---

## How it works

- **Block windows** are the times a site is gated, e.g. Mon–Fri 9:00–18:00. Outside them everything works normally and you can change any setting.
- **During a block window,** a blocked site redirects to the block page. It shows the site, your goal, how long until the window ends, and the ways to unlock.
- **Locked settings.** Inside a window, anything that would *loosen* the gate needs an unlock first (your goal is the exception and can always be edited). That includes turning a site off, removing it, switching it to "No block", editing schedules or requirements, turning grayscale off, or pausing FocusGate. Anything that *tightens* the gate (adding a site, turning one on, turning grayscale on) always works.
- **Unlocks:**
  - **Partner code:** unlocks one site (or your settings) for 15 minutes by default.
  - **Day review:** unlocks everything until midnight.
  - **Grayscale phrase:** restores colour on one site until its window ends.
  - When a temporary unlock runs out, the site locks again by itself, including any tab you still have open.

---

## Settings explained

Open settings from the popup (**Settings** link) or via right-click on the icon → **Options**.

### Sites

Each row is one site. A site always covers its subdomains, so `reddit.com` also blocks `www.`, `old.` and `m.reddit.com`.

| Control | What it does |
|---|---|
| **On/off switch** | Whether FocusGate acts on this site at all. Turning it off during a block window needs an unlock. |
| **Full block / No block** | *Full block* sends you to the block page during block windows. *No block* leaves the site usable; use it with Grayscale, or just to track your time there. |
| **Grayscale** | Shows the site in black and white during block windows. It works with either mode: on a full-block site it stays grey even while unlocked. Turning it off needs the typed phrase or an unlock. |
| **Global / Custom schedule** | *Global* uses the schedule below. *Custom* gives this site its own weekly schedule, edited right under its row (click **Save … schedule**). |
| **Status pill** | *blocked* (gated now), *unlocked* (temporarily open), *in window* (inside a block window but not blocked, e.g. in No block mode), *free* (outside its block window). The popup shows the same, plus the time left on an unlock. |
| **Remove** | Deletes the site. Needs an unlock during a block window. |
| **Add site** | Type a domain (`news.ycombinator.com`) or paste a URL. It always works, even during a window. |

### Global schedule

When blocking is active for every site set to *Global*.

- **Block all the time:** ignore the days below; the gate is always on.
- **Presets:** *Mon–Fri 9–18*, *Every day 9–18*, *Nights 22–07*, or *Clear*.
- **Per day:** each weekday can have any number of windows (**+ window**, **×** to remove). A window whose end time is at or before its start runs past midnight into the next day, shown as "(+1 day)". For example, Fri 22:00–02:00 blocks until Saturday 02:00.
- Times follow your computer's current timezone, including daylight-saving changes and travel.

### Your goal

The box at the top of the settings page. Write a goal for **today** ("Finish the Q3 report, reply to Sam") or one for **all time** ("Build things, don't scroll"). It appears on every block page and on the day review, as a reminder of what you're protecting your time for.

- **Always editable:** you can change your goal at any time, even during a block window, because changing it never loosens the gate. The block page has an **Edit** link straight to it.
- **Required:** it can't be empty, and the other settings can't be saved until a goal is set.

### Unlocks

- **Temporary unlock duration (minutes):** how long a partner code opens a site (or your settings). Default 15.

### Day review (voice)

In the evening, you speak a review of your day. If you talk long enough, everything unlocks until midnight. Every review is saved in a history on the review page.

- **Minimum speaking time (seconds):** default 90. This counts only time when you're actually talking; silence doesn't count.
- **Minimum words:** default 150.
- **Available after:** the review can't be started before this time of day. Default 17:00, so you can't do it at 9 am and have the whole day free.

### Accountability partner (optional)

Off until you configure it. When set up, the block page gets an **Ask my partner** button. You type a reason, your partner receives an email with a 6-digit code, the site, and your reason, and you type the code to unlock.

- **Partner name / email:** who gets the code.
- **Email backend:** *Google Apps Script* (recommended, see setup below), or *Generic webhook* for your own server.
- **Code expiry (minutes):** codes stop working after this long. Default 30.
- **Max requests per day:** default 3, so you can't spam your friend.
- **Backend URL / shared secret:** from the setup below.

Codes are never stored in readable form. After 5 wrong guesses a code stops working.

### Grayscale

- **Phrase:** what you must type to bring colour back to a greyed-out site. Default: *"I am not the master of my own mind, my mind controls me and I am weak"*. You type it on a separate page where paste, drag-and-drop, autocomplete and autocorrect are disabled. It must match exactly, though capitalisation doesn't matter. Colour then stays on until that site's current block window ends.

### Popup

- **Pause / Resume:** turns all blocking off or on. Pausing during a block window needs an unlock; resuming always works.
- **Switches and ×:** quick on/off and remove for each site (same rules as above).
- **color…:** appears next to sites that are currently grey and opens the phrase page.
- **Links:** Settings, Stats, Day review.

**Toolbar badge:** `12m` means a site is unlocked for 12 more minutes. `day` means the day review passed and everything is open until midnight. `off` means FocusGate is paused.

### Stats

The **Stats** page shows:

- time spent per site per day,
- unlock attempts and successes for each method,
- your current and longest **streak** (days with no unlocks during a block window).

Time is counted only while a tracked site's tab is focused and you're active at the computer.

---

## Partner email setup (optional, about 5 minutes)

A browser extension can't send email by itself. FocusGate hands the code to a tiny **Google Apps Script** that *you* deploy under your own Google account. It emails your partner from your Gmail. There's no third-party service, and nothing runs on anyone else's server.

1. Go to <https://script.google.com> and click **New project**. Name it `FocusGate mailer`.
2. Delete what's in `Code.gs` and paste in the contents of [`backend/apps-script/Code.gs`](backend/apps-script/Code.gs) from this repo.
3. Click the gear icon (**Project Settings**), scroll to **Script properties**, and add:
   | Property | Value |
   |---|---|
   | `SHARED_SECRET` | Any long random string (e.g. from a password generator). **Required.** |
   | `PARTNER_EMAIL` | Your partner's email address. **Recommended:** codes then always go here, even if someone changes the address in the extension. |
   | `MAX_PER_DAY` | Optional. A daily limit enforced on the server too (default 3). |
4. Back in the editor, pick `testSend` from the function dropdown and click **Run**. Allow the permissions Google asks for. You'll receive a test email.
5. Click **Deploy → New deployment**. Click the gear next to "Select type", choose **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Anyone. The shared secret is what keeps strangers out.

   Then click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. In FocusGate settings → **Accountability partner**, set:
   - **Email backend:** Google Apps Script
   - **Backend URL:** the `/exec` URL
   - **Backend shared secret:** the same `SHARED_SECRET`
   - Your partner's name and email

   Click **Save settings**.

To check it works, open the `/exec` URL in a browser. It should say `{"ok":true,"service":"focusgate-mailer"}`.

If you ever change the script, use **Deploy → Manage deployments → ✏️ Edit → Version: New version** so the URL stays the same.

**Your own server instead?** Choose *Generic webhook*. FocusGate POSTs `{to, partnerName, site, reason, code, expiresMinutes}` as JSON with an `Authorization: Bearer <secret>` header, and expects `{"ok": true}` back. The senders live in `src/lib/email.js`.

---

## Privacy

| Data | Where it goes |
|---|---|
| Sites, schedules, goals, settings, unlock state | Stored in your browser (`chrome.storage.local`). Never uploaded. |
| Time-on-site stats, review transcripts | Stored in your browser. Never uploaded. |
| Your voice | Transcribed **on your device** by Chrome's local speech model. FocusGate never uses cloud speech recognition. If on-device recognition isn't available, the review simply won't start. The first time, Chrome downloads its speech model (a one-time download *to* your computer; nothing is sent). |
| Partner unlock (only if you set it up) | When *you* press **Ask my partner**, the code, site name, and your typed reason go to *your* Apps Script, which emails your partner. Nothing else, and nothing if you never configure it. |

The extension contains no analytics, telemetry, remote code or external libraries.

**Why it asks for access to all websites:** so you can add *any* site to block. Chrome requires that permission to redirect a site to the block page and to apply grayscale. FocusGate only acts on the sites in your list.

---

## Honest limitations

- **You can always get around it.** Disabling or removing the extension at `chrome://extensions`, using another browser or profile, or an Incognito window (unless you enable "Allow in Incognito") all work. No extension can prevent that. FocusGate is friction, not a prison.
- **It's tamper-resistant, not tamper-proof.** Someone determined could edit its stored data with Chrome's developer tools. Partner codes are stored only as a slow, salted hash (PBKDF2, 2 million rounds), so recovering one takes hours of computing, longer than the code stays valid.
- **Speech needs Chrome's on-device model** for your language. If it isn't offered for your language, the day review isn't available (partner codes still work).
- **Timing:** blocks start and end on time. If your computer was asleep, things catch up within about a minute of waking.
- **Streaks** count days with no data as clean days, including days you never opened the browser.

---

## For developers

Plain JavaScript, HTML and CSS; no build step. Node is only needed for tests.

```sh
npm install
npx playwright install chromium
npm test               # unit tests: schedule maths, locking rules, hashing, stats, Apps Script
npm run test:e2e       # loads the extension into a real Chromium and drives it end to end
```

```
manifest.json
src/background/sw.js      service worker: the only writer of settings/state; rules, alarms, badge
src/lib/                  shared logic (schedule, status/locking, rules, crypto, stats, email)
src/content/core.js       grayscale, time tracking, and a backup redirect for cached/PWA pages
src/popup/ options/ block/ review/ phrase/ stats/
backend/apps-script/Code.gs
tests/unit/ tests/e2e/
```

Notes on how edge cases are handled:

- **Blocking layers.** Blocking uses `declarativeNetRequest` redirect rules. Those only see real network requests, so two backup layers cover pages a site's own service worker serves from cache (x.com does this) and Back/Forward restores: a `tabs.onUpdated` check in the service worker, and a self-redirect in the content script.
- **Browser restarts.** Unlocks are stored as absolute times, and state is recomputed on every browser start and service-worker wake-up. An unlock that expired while Chrome was closed is simply gone.
- **Timing accuracy.** Besides an exact alarm at the next change, a 1-minute alarm recomputes everything. That catches timezone changes, clock changes and sleep.
- **Extension updates.** Updating keeps settings and re-injects the content script into open tabs.
