# Understudy browser extension

Teach an understudy a task in your own Chrome instead of on its remote computer. You pick who you are teaching, press record, do the task in your tabs while explaining it out loud, and press stop. The panel turns your voice into text, lines it up with your steps and the understudy writes the recipe.

## How it works

| Piece | File | Job |
|---|---|---|
| Service worker | `src/background.ts` | Pairing, the recording session, the toolbar badge, injecting the capture script while recording, sending events in batches |
| Capture | `src/content.ts` + `packages/protocol/src/capture.ts` | The same capture script and secret masking the computer uses, plus the "Recording" sign on every page |
| Voice | `src/offscreen.ts` | `MediaRecorder` in an offscreen document; one clip per stretch of recording (pausing closes a clip, long stretches are cut every 4 minutes); each clip is uploaded with the time it started |
| Popup | `src/popup.ts`, `static/popup.*` | Connect, pick an understudy, record, pause, stop, see when the task is ready |
| Microphone | `src/mic.ts` | A tab that asks for the microphone once, since popups and offscreen documents cannot |

The extension only records while recording is on, never on the panel's own pages, and never on `chrome://` or file pages. Passwords, card numbers, security codes and one-time codes are masked in the page and masked again by the panel.

## Permissions

`storage`, `offscreen`, `scripting` and access to all sites, so it can capture clicks in whatever tabs the owner uses while recording.

## Build

```sh
pnpm --filter @understudy/extension build
```

This writes `dist/`. The panel serves it as a zip at `/api/extension/package.zip`, adding `config.json` with its own address and product name and icons drawn from the default character, so the folder people download is already pointed at their panel. The "Teach from browser" page in the panel walks a non-technical person through loading it with Developer mode.

## Tests

```sh
pnpm --filter @understudy/extension test
```

`src/capture.browser.test.ts` runs the shared capture script in a real Chrome (set `CHROME_PATH` if it is not in the usual place) and checks that secrets never leave the page.
