import SwiftUI

@main
struct LifeStackApp: App {
    @State private var model = AppModel()

    init() { LocationTracker.shared.startIfEnabled() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { Keychain.shareWithWidgets() }
                .preferredColorScheme(.dark)
        }
    }
}
