import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.signedIn { MainTabs() } else { SetupView() }
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
