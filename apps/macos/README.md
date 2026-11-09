# Life Stack for Mac

A menu bar app: a small icon in the top bar that drops down today's agenda and a quick log (caffeine, supplements,
mood). It shares the iPhone app's API client, models and key storage, and talks to the same `/api/v1` endpoints.

```
brew install xcodegen
cd apps/macos && xcodegen generate && open LifeStackMac.xcodeproj
```

Settings come from `apps/ios/Local.xcconfig` (gitignored): `API_BASE_URL`, your team and bundle id. Sign in once with
the same email and password as the web app; the password is traded for a key for this Mac, kept in the Keychain.
There is no Dock icon. Quit from the menu at the bottom of the dropdown.
