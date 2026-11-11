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
                    #if DEBUG
                    // Design aid: shows a sample card without signing in. Launch with -LS_SAMPLE_ACTIVITY now|next|allday.
                    if let mode = UserDefaults.standard.string(forKey: "LS_SAMPLE_ACTIVITY") { NextEventActivity.showSample(mode); return }
                    #endif
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
