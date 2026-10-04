import SwiftUI

struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<[CalendarItem]>()

    private var days: [(key: String, heading: String, items: [CalendarItem])] {
        var order: [String] = []; var map: [String: [CalendarItem]] = [:]
        for i in loader.value ?? [] { let k = Format.dayKey(i); if map[k] == nil { order.append(k) }; map[k, default: []].append(i) }
        return order.map { ($0, Format.dayHeading(map[$0]![0]), map[$0]!) }
    }

    var body: some View {
        Screen(title: "Calendar", refresh: { await load() }) {
            ErrorBanner(text: loader.error)
            ForEach(days, id: \.key) { day in
                Card(title: day.heading) { ForEach(day.items) { EventRow(item: $0) } }
            }
            if loader.value?.isEmpty == true { Card { Empty(text: "Nothing scheduled in the next 30 days.") } }
            if loader.value == nil && loader.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
    }

    private func load() async { await loader.load(model) { try await $0.calendar() } }
}
