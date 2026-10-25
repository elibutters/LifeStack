import SwiftUI
import WidgetKit

@main
struct LifeStackApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    init() { LocationTracker.shared.startIfEnabled() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task {
                    Keychain.shareWithWidgets()
                    await NextEventActivity.sync(model)
                }
                .onChange(of: phase) { _, new in
                    if new == .active {
                        WidgetCenter.shared.reloadAllTimelines()
                        LocationTracker.shared.refreshNow(ifOlderThan: 10)
                        Task { await AppConfig.refresh(model); await NextEventActivity.sync(model) }
                    }
                }
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}
