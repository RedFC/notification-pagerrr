# Discord Pager

A pager-style buzzer for important Discord messages. A Windows box captures Discord's desktop notifications and forwards them over the home network. The Mac checks them against your rules and, on a match, buzzes loudly until you acknowledge it (it stops by itself after 3 minutes).

It's one Electron + TypeScript app with two roles:

| Role | Runs on | Does |
| --- | --- | --- |
| **Listener** | Windows box (always on) | Reads Discord toasts through a small C# helper (`UserNotificationListener`) and sends them to paired buzzers. Advertises itself on the LAN (mDNS). |
| **Buzzer** | Mac | Receives events, applies the rules, buzzes. Menu-bar icon with on/off, snooze, status and recent alerts. |

The role is picked automatically (Windows → Listener, Mac → Buzzer) and can be changed in Settings → General.

---

## 1. Build and install

You need Node 22 on both machines, plus the .NET 8 SDK on Windows.

### Mac (Buzzer)

```bash
npm ci
npm run dist:mac          # → dist/*.dmg
```

Open the `.dmg` and drag the app to Applications. The build is ad-hoc signed, not notarized, so the first launch needs one of these:

- right-click the app → **Open** → **Open**, or
- `xattr -dr com.apple.quarantine "/Applications/Discord Pager.app"`

The app lives in the menu bar (there's no Dock icon). When macOS asks for **Local Network** access, allow it. Without it, the Mac can't find or reach the Windows box.

### Windows box (Listener)

The notification API only works for apps with *package identity*, so the Listener is installed as an MSIX. That MSIX has to be signed, and a self-signed certificate is fine for your own PC.

In an **elevated** PowerShell, from the project folder:

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts\make-cert.ps1     # once: creates + trusts build\discord-pager.pfx
$env:CSC_LINK = "$PWD\build\discord-pager.pfx"
$env:CSC_KEY_PASSWORD = "discord-pager"
npm run dist:win          # builds the C# helper, then dist\*.appx
```

Double-click the `.appx` to install it. The MSIX registers a startup task, so the app launches at login.

On first start, Windows asks whether Discord Pager may **access your notifications**. Allow it. If you missed the prompt, go to Settings → Privacy & security → Notifications and turn it on.

> **CI:** `.github/workflows/build.yml` builds both installers on GitHub Actions if you push the repo. The Windows artifact comes out unsigned; sign it with the steps above, or add `CSC_LINK` / `CSC_KEY_PASSWORD` secrets.

---

## 2. Set up the Windows box

The box has to stay logged in and awake with Discord running. Otherwise no notifications exist to capture.

- [ ] Auto-login to your user account after a restart. Notifications only exist in a signed-in session.
- [ ] Sleep and hibernate off. The screen can still turn off.
- [ ] Do Not Disturb / Focus Assist off.
- [ ] Settings → System → Notifications → **Discord**: notifications on, banners on, **"Show notifications in notification center" on**. The helper reads Discord's notifications from the notification center.
- [ ] Discord: starts on login, logged in, desktop notifications enabled (User Settings → Notifications).
- [ ] Per-server notification settings in Discord match your mention rules. For example, set watched servers to "Only @mentions".
- [ ] Allow Discord Pager through the firewall on **private** networks when prompted.
- [ ] Windows Update active hours set so restarts don't happen during the day.

---

## 3. Pair

1. On the Windows box, open the tray icon → **Start pairing**. A 2-minute pairing window opens.
2. On the Mac, open the menu-bar icon → **Settings… → Pairing**. Pick the Windows box from the list, or enter `IP:47821`.
3. The Windows box now shows a 6-digit code. Type it on the Mac and click **Pair**.

That's it. From now on the Mac reconnects by itself, including when the Windows box's IP changes.

How it's secured: the machines agree on a key with X25519. A commitment step, plus you comparing the code, blocks a man-in-the-middle. After that, every message is encrypted with AES-256-GCM, and keys are stored in the OS keychain (`safeStorage`).

---

## 4. Rules (Mac → Settings)

- **General → My Discord names:** your display name and server nicknames, comma-separated. These are used to detect `@you`.
- **DM watchlists:**
  - A DM from anyone on an enabled list buzzes.
  - Lists can be switched on and off as a whole.
  - "Include group DMs" also matches group-DM messages from those people.
- **Mention rules:** server + channel. An empty channel means any channel in that server. You can buzz on:
  - **@mentions of me** (optionally including @everyone / @here), or
  - **every message** in that channel.
  - Threads match their parent channel.
- **Recent notifications:** the last 50 Discord notifications, with **Add sender to…** and **Add channel as rule** buttons. This is the easiest way to get names spelled exactly as Discord shows them.

Names are matched case-insensitively against what the notification shows. That's the display name for DMs and the server nickname in servers.

## 5. Buzzer behaviour

- A match plays a looping tone and shows a flashing, always-on-top window on every display.
  - The app plays the sound itself, so it rings even with Focus / Do Not Disturb on. The Mac's system volume still applies.
- **Acknowledge** stops it. So does the hotkey `⌘⇧.`, which is active only while buzzing.
- **Open Discord** acknowledges and opens Discord.
- New matches while buzzing are added to the same alert, and the timer doesn't restart.
- After 3 minutes (configurable), the sound stops and a small **Missed** card stays in the top-right corner. The menu-bar icon shows a count.
- **Menu bar:** Enabled toggle, Snooze (15 min / 1 hour / until 9 AM), listener status, recent alerts, Test buzz.
- **Heartbeat:** the listener sends a heartbeat every 10 s. If the Mac hears nothing for 60 s, it plays a soft chime, shows a notification, and the icon changes to a warning.
  - Events sent while the Mac was offline are queued on Windows for 10 minutes and delivered when it reconnects.

---

## 6. First run on Windows: check the notification format (Milestone 0)

The parser assumes Discord's notification titles look like this:

| Case | Title | Body |
| --- | --- | --- |
| DM | `Ahmed` | message |
| Server channel | `Ahmed (#alerts, V4Tech)` | message |
| Thread | `Ahmed (#thread, #alerts, V4Tech)` | message |
| Group DM | `Ahmed (Group name)` | message |

To confirm:

1. On the Windows box, go to Settings → Captured notifications and turn on **"Write every notification to a capture log"**.
2. Have someone send you a DM, a group DM, and an @mention in a server channel.
3. Check the table on that tab, or click **Show log file** (`toast-capture.jsonl`).

If the titles look different, send me a few lines from that file and the parser gets adjusted. The tests in `tests/` use fixtures in the same format.

Also test this with Discord open on the Mac at the same time. Discord sometimes holds back desktop notifications on one device when you're active on another.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Windows tray says "Helper problem" | Open Settings → Pairing → Health for the exact error. "Access" errors → allow notification access (see install). "Helper not found" → the helper wasn't built; rerun `npm run dist:win`. |
| Mac says "Listener silent" | Is the Windows box awake and logged in? Is the app running there? Is the firewall rule on the *private* profile? |
| Mac can't find the Windows box | Allow Local Network access on the Mac (System Settings → Privacy & Security → Local Network). Or pair by `IP:47821`. |
| DM from a watched person didn't buzz | Settings → Recent notifications. If it's there, the name doesn't match exactly; use **Add sender to…**. If it isn't there, Windows never showed the notification (see the Windows box checklist). |
| Logs | `pager.log` in the app's data folder: `~/Library/Application Support/Discord Pager` on the Mac, `%APPDATA%\Discord Pager` on Windows. |

---

## Development

```bash
npm install
npm run dev          # run the app with hot reload
npm test             # parser, rules and link tests
npm run typecheck
```

You can simulate the listener without Windows. `PAGER_FAKE_TOAST_FILE=/tmp/toasts.jsonl npm run dev`, with role set to *listener* in the config, reads toasts from that file. Append lines like this one:

```json
{"id":"1","appId":"Discord","appName":"Discord","texts":["Ahmed","server is down"],"createdAt":"2026-09-27T10:00:00Z"}
```

```
src/
  main/
    index.ts                 app lifecycle, IPC, wiring for both roles
    link.ts                  listener server, buzzer client, pairing (plain Node, tested)
    crypto.ts                X25519 + HKDF + AES-GCM
    discovery.ts             mDNS advertise / browse
    store.ts                 config + history on disk, keys via safeStorage
    tray.ts                  tray / menu-bar menu
    listener/helperProcess.ts  runs the C# helper, checks Discord is running
    listener/discordParser.ts  toast → event
    buzzer/rules.ts          DM watchlists + mention rules
    buzzer/alertController.ts  buzz windows, sound, 3-minute cap, hotkey
  preload/                   window.pager API
  renderer/settings|alert|sound
helper-win/                  C# notification helper (.NET 8)
tests/                       Vitest tests + toast fixtures
build/appxmanifest.xml       MSIX manifest (notification listener capability, startup task)
```
