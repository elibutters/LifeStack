import SwiftUI

// The rightmost tab: a menu of the screens that do not get a tab of their own (see MoreItem in Navigator.swift).
struct MoreView: View {
    // Pushed on a stack that stays inside this tab. Replacing the tab's root view makes TabView
    // drop back to Overview, leaving the chosen screen underneath until More is opened again.
    @Environment(Navigator.self) private var nav

    var body: some View {
        @Bindable var nav = nav
        NavigationStack {
            menu
                .navigationDestination(item: $nav.more) { item in
                    destination(item)
                        .navigationBarBackButtonHidden(true)
                        .environment(\.screenBack, { nav.more = nil })
                }
        }
        .onChange(of: nav.more) { _, _ in nav.moreClosed() }
    }

    @ViewBuilder private func destination(_ item: MoreItem) -> some View {
        switch item {
        case .finance: FinanceView()
        case .sleep: SleepView()
        case .wants: WantsView()
        case .calendar: CalendarView()
        }
    }

    private var menu: some View {
        Screen(title: "More") {
            VStack(spacing: 8) {
                ForEach(MoreItem.allCases) { item in
                    Button { nav.more = item } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.icon).font(.title3).foregroundStyle(item.tint).frame(width: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.rawValue).font(.body.weight(.semibold)).foregroundStyle(.white)
                                Text(item.blurb).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                        }
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .panel()
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("more-\(item.rawValue.lowercased())")
                }
            }
        }
    }
}
