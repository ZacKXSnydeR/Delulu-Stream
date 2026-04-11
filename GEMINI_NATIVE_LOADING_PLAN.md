# Delulu Stream Native Loading + Jitter Reduction Plan

## Purpose
This plan is for execution by Gemini with minimal ambiguity.
Primary goal: remove perceived loading delay and jitter during page switches and season switches, while preserving the existing premium animation style.
Do not delete the design system or remove all smoothness.

## Baseline Snapshot
- Baseline commit: 104fd9c
- Baseline tag: checkpoint-2026-04-12-loading-baseline
- Repo: Delulu-Stream
- Branch at baseline: main

If anything goes wrong, revert to baseline:
1. `git checkout main`
2. `git reset --hard checkpoint-2026-04-12-loading-baseline`
3. `git push --force-with-lease origin main`

## Non-Negotiable Constraints
1. Keep existing visual language and theme.
2. Do not remove all animations globally.
3. Do not touch TorrentDetails layout logic unless explicitly needed for loading behavior.
4. Do not rewrite unrelated modules.
5. Do not run destructive git commands except explicit rollback section above.
6. Keep changes focused to the files listed in this plan.

## Known Current Pain Points (Confirmed)
1. Full-page skeleton hard swap on Details route changes causes perceived reset/jitter.
2. Season switch in episode selector does blocking loading and delayed scripted scrolling.
3. Trailer fetch currently blocks final loading completion in Details.

## Target Files (Allowed)
- `tauri.deluluapp/src/pages/Details.tsx`
- `tauri.deluluapp/src/components/content/SeasonEpisodeSelector.tsx`
- `tauri.deluluapp/src/components/content/SeasonEpisodeSelector.css`
- Optional helper file if needed: `tauri.deluluapp/src/hooks/useDeferredBusy.ts`

Do not modify other files unless execution requires a tiny type import fix.

## Phase 0: Execution Safety
1. Create a new branch:
   - `git checkout -b perf/native-loading-jitter-pass-1`
2. Confirm clean starting point on this branch:
   - `git status --short`
3. If not clean, stop and report before editing.

## Phase 1: Details Page Stale-While-Revalidate (No Full Reset)
### Objective
When navigating between Details pages, keep previous content visible until new payload arrives, instead of replacing whole page with `SkeletonDetail`.

### File
- `tauri.deluluapp/src/pages/Details.tsx`

### Required Changes
1. Replace hard loading gate behavior:
   - Current pattern: `if (isLoading || !details) return <SkeletonDetail/>`
   - New behavior:
     - Show `SkeletonDetail` only when `details` is null AND this is the initial unresolved load.
     - If previous details exist, keep rendering current UI while fetching next details.

2. Split fetch completion states:
   - Introduce two loading flags:
     - `isInitialLoading` for first ever load on empty state.
     - `isRefreshing` for background route-change fetch.
   - `isRefreshing` must not trigger full-page skeleton.

3. Prevent stale race updates:
   - Add a request token/ref counter in the effect.
   - Only latest request can update state.

4. Stop trailer from blocking primary content render:
   - Keep details + cast + release-date in main await path.
   - Trigger trailer fetch separately and non-blocking.
   - Set main loading done as soon as details/cast/release-date are ready.

5. Keep showTorrentUI deterministic:
   - On id/mediaType change, reset `showTorrentUI` to false immediately.

### Expected Result
- Route switch feels immediate.
- No full flash to skeleton after first resolved render.
- Trailer appears when ready without blocking page render.

## Phase 2: Season Switch Without Jank
### Objective
Switching season should feel immediate and not blank/jittery.

### File
- `tauri.deluluapp/src/components/content/SeasonEpisodeSelector.tsx`

### Required Changes
1. Remove long scripted scroll behavior:
   - Delete or disable custom `smoothScrollTo` animation with 1200ms duration.
   - Remove delayed `setTimeout(..., 400)` auto-scroll behavior.

2. Keep previous episodes visible during fetch:
   - Do not clear `episodes` before new season data arrives.
   - Keep old list rendered, then swap atomically when new list is ready.

3. Add season request race protection:
   - Use request token/ref so old season response cannot overwrite newer selection.

4. Loading indicator policy for season change:
   - Do not show big centered loader if existing episodes are present.
   - If existing episodes are present, use subtle inline switching indicator only.
   - Show full loader only when no episodes have ever been loaded.

5. Optional prefetch for adjacent seasons:
   - After successful season load, prefetch `selectedSeason + 1` and `selectedSeason - 1` if valid and uncached.
   - Prefetch must be background only; no blocking UI.

### Expected Result
- Season switch no longer feels like a page reset.
- No delayed jump or scripted motion stutter.
- Episode list updates smoothly.

## Phase 3: Deferred Busy Threshold (Avoid Loader Flash)
### Objective
Prevent loader flicker on quick requests.

### Files
- Preferred inline in existing files, or optional helper:
  - `tauri.deluluapp/src/hooks/useDeferredBusy.ts`

### Required Behavior
1. Introduce busy indicator threshold (~140ms).
2. If request resolves before threshold, show no loader.
3. If request exceeds threshold, show subtle loader.
4. Apply to:
   - Details initial/background loading distinction.
   - Season switching indicator.

### Expected Result
- Fast requests feel instant.
- No micro-flash of loading UI.

## Phase 4: Keep Smoothness, Remove Jitter Hotspots
### File
- `tauri.deluluapp/src/components/content/SeasonEpisodeSelector.css`

### Required CSS Tuning (Minimal)
1. Keep existing look.
2. Avoid expensive `transition: all` where possible on heavy cards.
3. Restrict transitions to explicit properties (`transform`, `opacity`, `border-color`, `box-shadow`).
4. Keep durations in the 120-220ms range for interactive states.

### Expected Result
- Same premium feel, less jitter under rapid interaction.

## Verification Checklist (Manual)
Run these scenarios in app after implementation:
1. Open Details page from Home.
2. Navigate quickly to another item Details page.
3. Confirm no full skeleton flash after first content render.
4. Open TV Details and switch seasons repeatedly (1->2->3->1 quickly).
5. Confirm episode list does not blank out between switches.
6. Confirm no delayed auto-scroll jumps.
7. Confirm TorrentDetails transition still feels sturdy and unchanged.
8. Confirm no visible layout regressions in title/meta/actions.

## Verification Commands
From `d:\DeluluStream\tauri.deluluapp`:
1. Type check/build:
   - `npm run build`
2. If unrelated pre-existing errors exist, report them explicitly and confirm no new errors from touched files.

## Commit Strategy
Use small commits per phase:
1. `perf(details): keep stale details visible during refresh`
2. `perf(season-selector): remove delayed scroll and non-blocking season switch`
3. `perf(loading): add deferred busy threshold`
4. `style(season-selector): narrow transition properties`

## Final Delivery Format (for Gemini response)
Gemini should report:
1. Files changed.
2. Behavior changes per phase.
3. Manual verification results.
4. Build/type-check result and whether failures are pre-existing or new.
5. Final commit hashes.

## Rollback Instructions
1. Revert specific commit(s):
   - `git revert <sha>` (repeat as needed)
2. Full rollback to baseline checkpoint:
   - `git reset --hard checkpoint-2026-04-12-loading-baseline`
   - `git push --force-with-lease origin main`
