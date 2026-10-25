import Observation
import SwiftUI

enum AppTab: Hashable {
    case overview, log, goals, workouts, more
}

// The screens that live inside the More tab. Add a case to add a screen.
enum MoreItem: String, CaseIterable, Identifiable, Hashable {
    case finance = "Finance", sleep = "Sleep", wants = "Wants", calendar = "Calendar"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .finance: "chart.bar"
        case .sleep: "bed.double"
        case .wants: "bag"
        case .calendar: "calendar"
        }
    }
    var blurb: String {
        switch self {
        case .finance: "Net worth, cash flow and spending"
        case .sleep: "Last night and recent nights"
        case .wants: "Things you are on the lookout for"
        case .calendar: "The next 30 days"
        }
    }
    // Same dusty tints as the site nav.
    var tint: Color {
        switch self {
        case .finance: Color(red: 0.498, green: 0.686, blue: 0.769)
        case .sleep: Color(red: 0.541, green: 0.620, blue: 0.784)
        case .wants: Color(red: 0.831, green: 0.627, blue: 0.659)
        case .calendar: Color(red: 0.769, green: 0.647, blue: 0.455)
        }
    }
}

// Which tab is showing and which More screen is open, shared so a card on one tab can open a screen on another. A screen opened
// this way remembers where it came from, so Back returns there instead of to the More menu.
@MainActor
@Observable
final class Navigator {
    var tab: AppTab = .overview
    var more: MoreItem?
    var returnTo: AppTab?

    func open(_ item: MoreItem, from tab: AppTab) {
        returnTo = tab
        more = item
        self.tab = .more
    }

    // Called when a More screen closes, by its back button or by swiping back.
    func moreClosed() {
        if more == nil, let back = returnTo { tab = back; returnTo = nil }
    }
}
