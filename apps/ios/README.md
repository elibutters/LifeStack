# Life Stack for iPhone

A small SwiftUI app that talks to your Life Stack deployment over HTTPS with an API key. Version 0.1 does
one thing: log mood, caffeine and supplements in one tap and show today's summary. Widgets come next.

Nothing personal is stored in this folder. You type your deployment address and key into the app on first
launch; the key is kept in the iOS Keychain on the device.

## Build

```
brew install xcodegen
cd apps/ios && xcodegen generate && open LifeStack.xcodeproj
```

Run on a simulator with no setup. To run on your own iPhone, copy `Local.xcconfig.example` to
`Local.xcconfig` and fill in your Apple team id and a bundle id of your own.

## Key

Create the key on the web app's **API keys** page with access **Can add and read today** (or the Agent
option). The app needs read and write on the log.
