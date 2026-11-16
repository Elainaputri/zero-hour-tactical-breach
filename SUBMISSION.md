# SUBMISSION — threejs-fps-02 "ZERO HOUR: TACTICAL BREACH"

- **Competition:** threejs-fps-02 "Make the best three.js tactical FPS" ($1,000: 1st $400, 2nd $200, 3rd $120, 4–10 $40)
- **Status:** SUBMITTED — stage `submitted`, round 2, outcome pending
- **Submission ID:** `01a1e5c1-2475-73a4-9f31-e9307c3bf8c9`
- **Submitted:** 2026-11-16T19:06:42Z (server time)
- **Repo:** https://github.com/Elainaputri/zero-hour-tactical-breach
- **Commit:** `9f68840e2aa0017d4059622e03dc3cbe681ebdac`
- **Title:** ZERO HOUR: TACTICAL BREACH
- **Replaces:** Dustline Protocol (earlier entry in fps-02, passed, score 738262) — re-entry per user GAS 2026-11-17 01:05 WIB
- **Entries close:** 2026-11-16T21:30:00Z (04:30 WIB 17 Nov) — **result due 2026-12-01T09:40:00Z (16:40 WIB)**
- **Quota after submit:** day cap 3, taken 1, left 2; hard limit 20, left 18; entries_made 2, entries_kept 2
- **Claim code:** in `~/workspace/makefun/threejs-fps-02-claim-code.txt` (mode 600, never echo)
- **Receipt/status JSON:** `~/workspace/makefun/threejs-fps-02-submission-zero-hour.json` (mode 600)

## Kit check (pre-submit, 2026-11-17 ~04:10 WIB)

**13 passed, 0 failed, 6 skipped, 5 at submission — all server checks pass** (account_wallet, competition_open, quota, form, entry_signature, repo_owner, repo_public, license_osi, repo_created_after_open).

- `thinking_reproduces`: **45.6% (1,750/3,831 authored lines, 0 pasted)** — was 2.9% (91/3,108) before the rewrite
- `thinking_priced`: 113 usage records; `thinking_revised`: game.js from 8 write/edit messages; `thinking_turns`: 956

## What the rewrite fixed

The first kit check failed only on `thinking_reproduces` (2.9% authored). Eight game modules were re-implemented from prose+data specs by 8 subagents (AudioEngine, UtilitySystem, TextureGenerator, HUD, Player, BotAI, Models, Touch+Spectator), then 49 integration fixes by the coordinator (HUD/BotAI API names, `_forward` sign, `_chestOf` call, `makePath`→`setPathTo`, `faceTo`→`faceToward`, `G.bomb.*` field names, etc.), plus a `_dist` NaN fix (2D site/nav objects have no `.y`).

## Verification (post-rewrite, headless Chromium + SwiftShader WebGL2)

- **engage-probe (03:37–03:44 WIB): PASS** — both attackers reached Site A; real combat (VIPER damaged 100→64, idle player killed by ONYX); FSM states FLANK / ENGAGE_COVER / INVESTIGATE_SOUND / PATROL_SITE observed; **0 console errors**
- **playtest: PASS** — boot, buy screen, live round, ammo 12 after firing; 0 errors, 0 external requests, 0 failed requests
- **Screenshots (fresh from rewritten build, 1280×480, ≤256 KiB):** 1-title 63,983 B; 2-play 49,806 B; 3-action 45,814 B; 4-end VICTORY 5:3, MVP YOU, 44,260 B

## Bundle

- Transcripts: `~/workspace/makefun/threejs-fps-02-transcripts.tar.gz` (4,755,240 B, sha256 `f1a8df2b12e0a67b4edf89062c33c80409b8c5f6c4fd8762171f5fafc10f3ecf`), **37 sessions** (29 + 8 rewrite agents), 200 usage rows
- No claim-code leak: 0 hits for the redacted terms in the bundle
- Status note from server: grading backlog — "Your submission is received and still processing… do not resubmit." Poll after 300s.
