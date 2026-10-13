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
            SleepView().tabItem { Label("Sleep", systemImage: "bed.double") }
            WorkoutsView().tabItem { Label("Workouts", systemImage: "figure.run") }
            FinanceView().tabItem { Label("Finance", systemImage: "chart.bar") }
            MoreView().tabItem { Label("More", systemImage: "line.3.horizontal") }
        }
    }
}
