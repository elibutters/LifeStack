import SwiftUI
import WidgetKit

struct OverviewEntry: TimelineEntry {
    let date: Date
    let overview: Overview?
    var options: LogOptions? = nil
    let signedIn: Bool
}

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry { OverviewEntry(date: .now, overview: nil, signedIn: true) }
    private func load() async -> OverviewEntry {
        async let o = WidgetData.load(Overview.self, path: "api/v1/overview", cacheOnly: WidgetData.showingOptimistic)
        async let l = WidgetData.load(LogOptions.self, path: "api/v1/log/options", maxAge: 60 * 60)
        let (ov, lo) = await (o, l)
        return OverviewEntry(date: .now, overview: ov.value, options: lo.value, signedIn: ov.signedIn)
    }
    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) {
        Task { completion(await load()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        Task { completion(Timeline(entries: [await load()], policy: .after(.now.addingTimeInterval(WidgetData.refresh)))) }
    }
}

// What the widgets put under Now / Next. A live event wins; otherwise the soonest one still to start, then an all-day item today.
struct CalendarFocus {
    let item: CalendarItem
    let live: Bool
    var label: String { live ? "NOW" : "NEXT" }
    var when: String {
        if live, let end = Format.date(item.end), let start = Format.date(item.start), end > start {
            return "Until \(end.formatted(date: .omitted, time: .shortened))"
        }
        return Format.upcoming(item)
    }
}

extension Overview {
    var score: Double? { sleep?.lastNight?.score }
    var asleep: String { Format.minutes(sleep?.lastNight?.sleepMin) }
    var focus: CalendarFocus? {
        let items = (calendar?.today ?? []) + (calendar?.soon ?? [])
        let now = Date()
        let timed: [(CalendarItem, Date, Date)] = items.compactMap { item in
            guard !item.allDay, let start = Format.date(item.start) else { return nil }
            let end = Format.date(item.end).flatMap { $0 > start ? $0 : nil } ?? start.addingTimeInterval(60 * 60)
            guard end > now else { return nil }
            return (item, start, end)
        }
        if let live = timed.filter({ $0.1 <= now }).max(by: { $0.1 < $1.1 }) { return CalendarFocus(item: live.0, live: true) }
        if let next = timed.filter({ $0.1 > now }).min(by: { $0.1 < $1.1 }) { return CalendarFocus(item: next.0, live: false) }
        let cal = Foundation.Calendar.current
        guard let allDay = items.first(where: { item in
            guard item.allDay, let day = Format.dayDate(String(item.start.prefix(10))) else { return false }
            return cal.isDate(day, inSameDayAs: now)
        }) else { return nil }
        return CalendarFocus(item: allDay, live: false)
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

    // The lock screen rectangle is the largest shape iOS allows there, so it carries three lines: sleep, today's log, the next event.
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Sleep \(scoreText) \u{00B7} \(o?.asleep ?? "-")").font(.headline)
            Text(logLine).font(.caption)
            if let e = o?.focus { Text("\(e.live ? "Now" : e.when) \(e.item.title)").font(.caption).lineLimit(1) }
            else { Text("Nothing else today").font(.caption) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var logLine: String {
        let taken = o?.supplementsTaken ?? 0
        let total = entry.options?.supplements.count
        let mg = o?.log.map { Int($0.caffeine.mg) } ?? 0
        return "Supps \(total.map { "\(taken)/\($0)" } ?? "\(taken)") \u{00B7} \(mg) mg"
    }

    private var inline: some View { Text("Sleep \(scoreText) \u{00B7} \(o?.asleep ?? "-")") }

    private var small: some View {
        VStack(spacing: 6) {
            ZStack {
                Ring(fraction: (o?.score ?? 0) / 100, width: 9)
                VStack(spacing: 0) {
                    Text(scoreText).font(.system(size: 30, weight: .semibold)).monospacedDigit()
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
                    Text(o?.focus?.label ?? "NEXT").font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted)
                    if let e = o?.focus {
                        Text(e.item.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text(e.when).font(.caption).foregroundStyle(WColor.sky)
                    } else { Text("Nothing scheduled").font(.subheadline).foregroundStyle(WColor.muted) }
                }
                HStack(spacing: 12) {
                    stat("Supps", "\(o?.supplementsTaken ?? 0)")
                    stat("Caffeine", o?.log.map { "\(Int($0.caffeine.mg)) mg" } ?? "0 mg")
                    if let m = o?.log?.mood { stat("Mood", String(m.value)) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // One word on the top left, the current amount underneath, so nothing wraps mid-word.
    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted).lineLimit(1)
            Text(value).font(.system(.body).weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
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
