import SwiftUI
import WidgetKit

@main
struct LifeStackApp: App {
    @State private var model = AppModel()
    @State private var pulse = PulseMonitor()
    @Environment(\.scenePhase) private var phase

    init() { LocationTracker.shared.startIfEnabled() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(pulse)
                .task {
                    Keychain.shareWithWidgets()
                    if phase == .active { pulse.start(model) }
                    #if DEBUG
                    // Design aid: shows a sample card without signing in. Launch with -LS_SAMPLE_ACTIVITY now|next|allday.
                    if let mode = UserDefaults.standard.string(forKey: "LS_SAMPLE_ACTIVITY") { NextEventActivity.showSample(mode); return }
                    #endif
                    await NextEventActivity.sync(model)
                }
                // Something changed on the server: refresh what the lock screen and home screen show too. Open screens reload themselves.
                .onChange(of: pulse.tick) { _, _ in
                    WidgetCenter.shared.reloadAllTimelines()
                    Task { await NextEventActivity.sync(model) }
                }
                .onChange(of: phase) { _, new in
                    if new != .active { pulse.stop() }
                    if new == .active {
                        pulse.start(model)
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
