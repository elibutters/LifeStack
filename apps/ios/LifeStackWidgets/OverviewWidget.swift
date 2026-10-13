import SwiftUI
import WidgetKit

struct OverviewEntry: TimelineEntry {
    let date: Date
    let overview: Overview?
    let signedIn: Bool
}

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry { OverviewEntry(date: .now, overview: nil, signedIn: true) }
    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) {
        Task { let r = await WidgetData.load(Overview.self, path: "api/v1/overview"); completion(OverviewEntry(date: .now, overview: r.value, signedIn: r.signedIn)) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        Task {
            let r = await WidgetData.load(Overview.self, path: "api/v1/overview")
            let entry = OverviewEntry(date: .now, overview: r.value, signedIn: r.signedIn)
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(WidgetData.refresh))))
        }
    }
}

private extension Overview {
    var score: Double? { sleep?.lastNight?.score }
    var asleep: String { Format.minutes(sleep?.lastNight?.sleepMin) }
    // The next event that has not started yet, else the first all-day item today.
    var nextEvent: CalendarItem? {
        let items = (calendar?.today ?? []) + (calendar?.soon ?? [])
        let upcoming = items.filter { !$0.allDay && (Format.date($0.start).map { $0 > .now } ?? false) }
        return upcoming.first ?? items.first { $0.allDay }
    }
    var supplementsTaken: Int { log?.supplements.filter { $0.count > 0 }.count ?? 0 }
}

struct OverviewWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: OverviewEntry

    var body: some View {
        Group {
            if !entry.signedIn { SignedOut() }
            else {
                switch family {
                case .accessoryCircular: circular
                case .accessoryRectangular: rectangular
                case .accessoryInline: inline
                case .systemMedium: medium
                default: small
                }
            }
        }
        .containerBackground(for: .widget) { WColor.bg }
    }

    private var o: Overview? { entry.overview }
    private var scoreText: String { o?.score.map { String(Int($0.rounded())) } ?? "-" }

    private var circular: some View {
        Gauge(value: (o?.score ?? 0) / 100) { Text("Sleep") } currentValueLabel: { Text(scoreText) }
            .gaugeStyle(.accessoryCircularCapacity)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Sleep \(scoreText) \u{00B7} \(o?.asleep ?? "-")").font(.headline)
            if let e = o?.nextEvent { Text("\(Format.time(e)) \(e.title)").font(.caption).lineLimit(2) }
            else { Text("Nothing else today").font(.caption) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var inline: some View { Text("Sleep \(scoreText) \u{00B7} \(o?.asleep ?? "-")") }

    private var small: some View {
        VStack(spacing: 6) {
            ZStack {
                Ring(fraction: (o?.score ?? 0) / 100, width: 9)
                VStack(spacing: 0) {
                    Text(scoreText).font(.system(size: 30, weight: .semibold, design: .rounded)).monospacedDigit()
                    Text("sleep").font(.caption2).foregroundStyle(WColor.muted)
                }
            }
            .frame(width: 84, height: 84)
            Text(o?.asleep ?? "No data").font(.caption).foregroundStyle(WColor.muted)
        }
    }

    private var medium: some View {
        HStack(spacing: 14) {
            small.frame(width: 100)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("NEXT").font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted)
                    if let e = o?.nextEvent {
                        Text(e.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text(Format.time(e)).font(.caption).foregroundStyle(WColor.sky)
                    } else { Text("Nothing scheduled").font(.subheadline).foregroundStyle(WColor.muted) }
                }
                HStack(spacing: 12) {
                    stat("\(o?.supplementsTaken ?? 0)", "supps")
                    stat(o?.log.map { String(Int($0.caffeine.mg)) } ?? "0", "mg caffeine")
                    if let m = o?.log?.mood { stat(String(m.value), "mood") }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func stat(_ v: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(v).font(.system(.body, design: .rounded).weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(WColor.muted)
        }
    }
}

struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeStackOverview", provider: OverviewProvider()) { OverviewWidgetView(entry: $0) }
            .configurationDisplayName("Today")
            .description("Last night's sleep, your next event and today's log.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
