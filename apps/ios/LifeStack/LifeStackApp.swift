import SwiftUI

@main
struct LifeStackApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    init() { LocationTracker.shared.startIfEnabled() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { Keychain.shareWithWidgets() }
                .onChange(of: phase) { _, new in if new == .active { LocationTracker.shared.refreshNow(ifOlderThan: 10) } }
                .preferredColorScheme(.dark)
        }
    }
}
