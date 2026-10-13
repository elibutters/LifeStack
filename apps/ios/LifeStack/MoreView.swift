import SwiftUI

// The rightmost tab: a menu of the screens that do not get a tab of their own. Add a case to add a screen.
private enum MoreItem: String, CaseIterable, Identifiable {
    case log = "Log", wants = "Wants", calendar = "Calendar"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .log: "checkmark.circle"
        case .wants: "bag"
        case .calendar: "calendar"
        }
    }
    var blurb: String {
        switch self {
        case .log: "Mood, caffeine and supplements"
        case .wants: "Things you are on the lookout for"
        case .calendar: "The next 30 days"
        }
    }
}

struct MoreView: View {
    @State private var open: MoreItem?

    var body: some View {
        Group {
            switch open {
            case .none: menu
            case .log: TodayView()
            case .wants: WantsView()
            case .calendar: CalendarView()
            }
        }
        .environment(\.screenBack, open == nil ? nil : { open = nil })
    }

    private var menu: some View {
        Screen(title: "More") {
            VStack(spacing: 8) {
                ForEach(MoreItem.allCases) { item in
                    Button { open = item } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.icon).font(.title3).foregroundStyle(Theme.sky).frame(width: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.rawValue).font(.body.weight(.semibold)).foregroundStyle(.white)
                                Text(item.blurb).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                        }
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: Theme.r))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("more-\(item.rawValue.lowercased())")
                }
            }
        }
    }
}
