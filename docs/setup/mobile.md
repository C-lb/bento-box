# Bento mobile runbook (Capacitor, iOS)

The app is served remotely: the native shell loads the hosted Spark server URL via `server.url` in
`packages/mobile/capacitor.config.ts`. `www/` holds only the offline fallback page. `ios/` is untracked
by design: it is regenerated from config, and anything that must survive regeneration lives in this
runbook.

Android is not in scope yet; add an `android/` bring-up section here if it's ever needed.

## Prerequisites

- Full Xcode (the command-line tools alone are not enough): `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (check the active toolchain with `xcode-select -p`).
- CocoaPods, for the native dependency install `cap sync` runs under the hood: `sudo gem install cocoapods` (or `brew install cocoapods`).
- An Apple ID signed into Xcode. A free personal team is enough to run on your own device (7-day provisioning profile, needs re-signing weekly); the $99/year Apple Developer Program removes the 7-day limit and is required for TestFlight or the App Store.

`packages/mobile` is deliberately self-contained: its own `package.json` inside the npm workspaces glob
(`packages/*`), so `npm install` at the repo root picks it up like any other workspace. No exclusion was
needed: the Capacitor CLI and plugins install as plain npm packages with no postinstall step that
conflicts with the root install, and `npm ci` at the root stays green with it present.

## Configuration

Before building, point the shell at the real hosted URL from `docs/setup/server.md` (Task 2's tunnel or
production host):

```ts
// packages/mobile/capacitor.config.ts
server: {
  url: "https://bento.example.com", // <- replace with the real hostname
  errorPath: "error.html",
},
```

Do not drop `errorPath`. Without it the offline page ships inside the app bundle but the shell never
routes to it when the network drops, so a real disconnect just shows a blank WKWebView (the same lesson
Nexus hit on Android).

## Build steps

```sh
cd packages/mobile
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

- `cap add ios` scaffolds the `ios/` Xcode project from `capacitor.config.ts`. It is untracked
  (`packages/mobile/.gitignore`), so re-run this after every clone or after deleting `ios/`.
- `cap sync ios` copies `www/` into the project and runs `pod install`. This is the step that needs
  Xcode's CocoaPods toolchain; on a machine without Xcode it stops here with a pod install failure, which
  is expected and not a config bug.
- `cap open ios` opens the generated project in Xcode.

## Cleartext (http) dev server — ATS exception

When `server.url` is a plain-http LAN address (dev against a Mac on the same Wi-Fi), iOS App
Transport Security blocks the load and the shell shows only the offline page. `cleartext: true` in
`capacitor.config.ts` is not enough on iOS — add to `ios/App/App/Info.plist` (top of the main dict):

```xml
<key>NSAppTransportSecurity</key>
<dict>
	<key>NSAllowsArbitraryLoads</key>
	<true/>
</dict>
```

`ios/` is untracked, so re-apply this after every `cap add ios`. Remove it (and `cleartext`) when
pointing at the real https tunnel host.

## Signing and device run

1. In Xcode, select the `App` target > Signing & Capabilities.
2. Pick your team under "Team". A free personal team works for local device runs; it issues a 7-day
   provisioning profile, so re-build and re-install weekly. Enroll in the paid Apple Developer Program to
   drop that limit and to enable TestFlight distribution.
3. Connect a device (or pick a simulator), select it as the run destination, and hit Run. First run on a
   physical device also needs "Trust This Developer" approved once under Settings > General > VPN & Device
   Management on the device itself.

## StatusBar gotcha

`@capacitor/status-bar` style tokens are case-sensitive and must be UPPERCASE (`Style.Light` /
`Style.Dark`, i.e. the string values `"LIGHT"` / `"DARK"`), matching the Nexus lesson on Android. Passing
lowercase silently no-ops instead of throwing, so a StatusBar call that "does nothing" is almost always
this.

## Icon and splash

Reuse the Bento glyph already shipped for the v0.0.9 desktop release rather than regenerating art:

- Source icon: `packages/desktop/icons/icon.png` (and the packaged `.icns` at
  `packages/desktop/icons/icon.icns`, macOS-only, not usable for iOS asset generation directly).

Generate the iOS asset catalog from the PNG:

```sh
npx @capacitor/assets generate --ios --iconBackgroundColor '#f5f6f8' --assetPath packages/desktop/icons
```

`@capacitor/assets` expects `icon.png` (square, at least 1024px) and an optional `splash.png` in the
asset path; only `icon.png` exists today, so the tool falls back to a plain background for the splash
screen until a dedicated splash source is produced. If a proper splash is wanted later, drop a
`splash.png` (2732px, same canvas colour `#f5f6f8`) next to `icon.png` and re-run the command.

## What this repo has verified without Xcode

This machine has no Xcode installed, so `npx cap add ios` / `npx cap sync ios` were not exercised
end-to-end here; that step is expected to stop at CocoaPods install on a bare CLT machine. What was
verified instead:

- `npx tsc --noEmit capacitor.config.ts` from `packages/mobile/` is clean.
- `packages/mobile/www/error.html` renders correctly at 390x844 (light mode confirmed via Playwright
  screenshot at `.superpowers/sdd/task-11-error.png`; dark mode follows `prefers-color-scheme` with no
  JS branching, same markup).
- Adding `packages/mobile` as a workspace does not break the root install: `npm install` then
  `npm ci` both succeed from a clean `node_modules`, and `npm -w @event-editor/web run test` stays green
  (207 tests).

## Store checklist (not started)

- Accounts: Apple Developer Program (yearly), not yet enrolled.
- Listing: app name, description, category, support contact, privacy policy URL.
- Screenshots: iOS 6.7" and 6.5" phone sets, captured from a real device pass.
- Privacy: Apple privacy nutrition labels (account data, messages, uploaded files) matching whatever the
  hosted app actually collects.
- Submission: start with TestFlight internal testing, then promote to App Store review.
