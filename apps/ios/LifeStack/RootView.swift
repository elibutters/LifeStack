import SwiftUI
import UIKit

// A tab glyph drawn in its own quiet color, instead of the single accent tint.
private func tabIcon(_ name: String, _ color: UIColor) -> Image {
    let ui = UIImage(systemName: name)?.withTintColor(color, renderingMode: .alwaysOriginal) ?? UIImage()
    return Image(uiImage: ui)
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.signedIn { MainTabs() } else { SetupView() }
    }
}

struct MainTabs: View {
    // The selected tab lives in the navigator, so a push inside More cannot fall back to the first tab and a card can open a screen.
    @State private var nav = Navigator()

    var body: some View {
        TabView(selection: $nav.tab) {
            // The navigation bar stays hidden for the life of the tab. Hiding it again as a screen opens
            // makes the tab bar drop back to Overview.
            Tab(value: .overview) { OverviewView().toolbar(.hidden, for: .navigationBar) } label: {
                Label { Text("Overview") } icon: { tabIcon("square.grid.2x2", UIColor(red: 0.557, green: 0.706, blue: 0.878, alpha: 1)) }
            }
            Tab(value: .log) { TodayView().toolbar(.hidden, for: .navigationBar) } label: {
                Label { Text("Log") } icon: { tabIcon("checkmark.circle", UIColor(red: 0.769, green: 0.627, blue: 0.541, alpha: 1)) }
            }
            Tab(value: .goals) { GoalsView().toolbar(.hidden, for: .navigationBar) } label: {
                Label { Text("Goals") } icon: { tabIcon("scope", UIColor(red: 0.718, green: 0.643, blue: 0.831, alpha: 1)) }
            }
            Tab(value: .workouts) { WorkoutsView().toolbar(.hidden, for: .navigationBar) } label: {
                Label { Text("Fitness") } icon: { tabIcon("figure.run", UIColor(red: 0.431, green: 0.682, blue: 0.565, alpha: 1)) }
            }
            Tab(value: .more) { MoreView().toolbar(.hidden, for: .navigationBar) } label: {
                Label { Text("More") } icon: { tabIcon("line.3.horizontal", UIColor(red: 0.604, green: 0.639, blue: 0.678, alpha: 1)) }
            }
        }
        .tint(Theme.accent)
        .environment(nav)
    }
}
