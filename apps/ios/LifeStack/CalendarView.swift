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
        NavigationStack {
            List {
                ErrorRow(text: loader.error)
                ForEach(days, id: \.key) { day in
                    Section(day.heading) { ForEach(day.items) { EventRow(item: $0) } }
                }
                if loader.value?.isEmpty == true { Section { Text("Nothing scheduled in the next 30 days.").foregroundStyle(.secondary) } }
                if loader.value == nil && loader.loading { Section { ProgressView() } }
            }
            .navigationTitle("Calendar")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async { await loader.load(model) { try await $0.calendar() } }
}
