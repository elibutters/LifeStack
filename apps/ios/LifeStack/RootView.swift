import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            if model.signedIn { MainTabs() } else { SetupView() }
            // Cover the content while locked and whenever the app is not active, so the app switcher shows nothing.
            if model.signedIn && (model.locked || phase != .active) { LockView() }
        }
        .onChange(of: phase) { _, new in
            if new == .background { model.lock() }
            if new == .active && model.locked { Task { await model.unlock() } }
        }
        .task { if model.locked { await model.unlock() } }
    }
}

struct LockView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Rectangle().fill(.background).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "lock.fill").font(.system(size: 36))
                Text("Life Stack is locked").font(.headline)
                Button("Unlock") { Task { await model.unlock() } }.buttonStyle(.borderedProminent)
            }
        }
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            OverviewView().tabItem { Label("Overview", systemImage: "square.grid.2x2") }
            CalendarView().tabItem { Label("Calendar", systemImage: "calendar") }
            SleepView().tabItem { Label("Sleep", systemImage: "bed.double") }
            FinanceView().tabItem { Label("Finance", systemImage: "chart.bar") }
            TodayView().tabItem { Label("Log", systemImage: "checkmark.circle") }
        }
    }
}
