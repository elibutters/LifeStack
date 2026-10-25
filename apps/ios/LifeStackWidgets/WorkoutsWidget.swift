import SwiftUI
import WidgetKit

struct WorkoutsEntry: TimelineEntry {
    let date: Date
    let overview: WorkoutsOverview?
    let signedIn: Bool
}

struct WorkoutsProvider: TimelineProvider {
    private static let query = [URLQueryItem(name: "weeks", value: "8"), URLQueryItem(name: "recent", value: "1")]
    func placeholder(in context: Context) -> WorkoutsEntry { WorkoutsEntry(date: .now, overview: nil, signedIn: true) }
    func getSnapshot(in context: Context, completion: @escaping (WorkoutsEntry) -> Void) {
        Task { let r = await WidgetData.load(WorkoutsOverview.self, path: "api/v1/workouts", query: Self.query); completion(WorkoutsEntry(date: .now, overview: r.value, signedIn: r.signedIn)) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WorkoutsEntry>) -> Void) {
        Task {
            let r = await WidgetData.load(WorkoutsOverview.self, path: "api/v1/workouts", query: Self.query)
            completion(Timeline(entries: [WorkoutsEntry(date: .now, overview: r.value, signedIn: r.signedIn)], policy: .after(.now.addingTimeInterval(WidgetData.refresh))))
        }
    }
}

struct WorkoutsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WorkoutsEntry

    private var o: WorkoutsOverview? { entry.overview }
    private var week: Double { o.map { Format.miles($0.totals.last7.distanceM) } ?? 0 }
    // Compare to the average of the weeks before this one, so the ring fills as the week catches up.
    private var typical: Double {
        let past = (o?.weeks.dropLast() ?? []).suffix(6).map { Format.miles($0.distanceM) }
        return max(1, past.isEmpty ? 10 : past.reduce(0, +) / Double(past.count))
    }

    var body: some View {
        Group {
            if !entry.signedIn { SignedOut() }
            else {
                switch family {
                case .accessoryCircular:
                    Gauge(value: min(1, week / typical)) { Text("mi") } currentValueLabel: { Text(String(format: "%.0f", week)) }.gaugeStyle(.accessoryCircularCapacity)
                case .accessoryInline:
                    Text(String(format: "%.1f mi this week", week))
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(format: "%.1f mi \u{00B7} 7 days", week)).font(.headline)
                        Text("\(o?.streakWeeks ?? 0) week streak").font(.caption)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                default:
                    VStack(spacing: 6) {
                        ZStack {
                            Ring(fraction: week / typical, width: 9)
                            VStack(spacing: 0) {
                                Text(String(format: "%.1f", week)).font(.system(size: 26, weight: .semibold)).monospacedDigit()
                                Text("mi, 7 days").font(.caption2).foregroundStyle(WColor.muted)
                            }
                        }.frame(width: 90, height: 90)
                        Text("\(o?.streakWeeks ?? 0) week streak").font(.caption).foregroundStyle(WColor.muted)
                    }
                }
            }
        }
        .containerBackground(for: .widget) { WColor.bg }
    }
}

struct WorkoutsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeStackWorkouts", provider: WorkoutsProvider()) { WorkoutsWidgetView(entry: $0) }
            .configurationDisplayName("Running")
            .description("Miles in the last 7 days against your recent weeks.")
            .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
