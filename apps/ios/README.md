# Life Stack for iPhone

A small SwiftUI app that talks to your Life Stack deployment over HTTPS with an API key. Version 0.1 does
password sign-in, plus an Overview, Calendar, Sleep, Finance, Log and Account screen. Widgets come next.

Nothing personal is stored in this folder. You type your deployment address and key into the app on first
launch; the key is kept in the iOS Keychain on the device.

## Build

```
brew install xcodegen
cd apps/ios && xcodegen generate && open LifeStack.xcodeproj
```

Copy `Local.xcconfig.example` to `Local.xcconfig` (gitignored) and set `API_BASE_URL` to your deployment. To run on your
own iPhone also fill in your Apple team id and a bundle id of your own. If `API_BASE_URL` is empty the sign-in screen
asks for the address instead.

## Signing in

Enter the same email and password as the web app. The deployment address is built into the app (see below), so it is never typed. You sign in once: the password is sent over
HTTPS to `POST /api/v1/auth/login`, never stored, and traded for a key made for this phone that lives in the iOS
Keychain. The app has no Face ID lock for now. Revoke the phone's key any time on the web app's **API keys**
page, and the app signs itself out.

## Screens

Overview, Calendar, Sleep, Finance and Log are tabs; the profile button on Overview opens Account (profile and
connection status). Everything is read from `/api/v1`.

## Tests

`apps/ios/LifeStackUITests` signs in against a development server and visits each screen. Run it with a
throwaway password set on that server and a reset simulator Keychain:

```
xcrun simctl keychain <device> reset
TEST_RUNNER_LS_EMAIL=... TEST_RUNNER_LS_PASSWORD=... xcodebuild test -project LifeStack.xcodeproj -scheme LifeStack -destination 'platform=iOS Simulator,name=iPhone 18 Pro' CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO -only-testing:LifeStackUITests 'API_BASE_URL=http:/$()/localhost:3000'
```
