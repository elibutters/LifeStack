import AppIntents
import SwiftUI
import WidgetKit

struct LargeEntry: TimelineEntry {
    let date: Date
    let overview: Overview?
    let options: LogOptions?
    let workouts: WorkoutsOverview?
    let signedIn: Bool
}

struct LargeProvider: TimelineProvider {
    private static let weeks = [URLQueryItem(name: "weeks", value: "8"), URLQueryItem(name: "recent", value: "1")]
    private func load() async -> LargeEntry {
        async let o = WidgetData.load(Overview.self, path: "api/v1/overview")
        async let l = WidgetData.load(LogOptions.self, path: "api/v1/log/options")
        async let w = WidgetData.load(WorkoutsOverview.self, path: "api/v1/workouts", query: Self.weeks)
        let (ov, lo, wo) = await (o, l, w)
        return LargeEntry(date: .now, overview: ov.value, options: lo.value, workouts: wo.value, signedIn: ov.signedIn)
    }
    func placeholder(in context: Context) -> LargeEntry { LargeEntry(date: .now, overview: nil, options: nil, workouts: nil, signedIn: true) }
    func getSnapshot(in context: Context, completion: @escaping (LargeEntry) -> Void) { Task { completion(await load()) } }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LargeEntry>) -> Void) {
        Task { completion(Timeline(entries: [await load()], policy: .after(.now.addingTimeInterval(WidgetData.refresh)))) }
    }
}

// The big one: today's numbers and the quick logs in one place. Every pill is a button that logs without opening the app.
struct LargeWidgetView: View {
    let entry: LargeEntry
    private var o: Overview? { entry.overview }
    private var supplements: [String] { entry.options?.supplements.map(\.name) ?? [] }
    private var taken: Set<String> { Set((o?.log?.supplements ?? []).filter { $0.count > 0 }.map { $0.name.lowercased() }) }
    private var moodNow: Int? { o?.log?.mood?.value }
    private var week: Double { entry.workouts.map { Format.miles($0.totals.last7.distanceM) } ?? 0 }

    var body: some View {
        Group {
            if !entry.signedIn { SignedOut() }
            else {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    moodRow
                    caffeineRow
                    supplementBlock
                    Spacer(minLength: 0)
                    Text(String(format: "%.1f mi this week \u{00B7} %d week streak", week, entry.workouts?.streakWeeks ?? 0)).font(.caption).foregroundStyle(WColor.muted)
                }
            }
        }
        .containerBackground(for: .widget) { WColor.bg }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                Ring(fraction: (o?.score ?? 0) / 100, width: 6)
                Text(o?.score.map { String(Int($0.rounded())) } ?? "-").font(.system(size: 18, weight: .semibold, design: .rounded)).monospacedDigit()
            }
            .frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 1) {
                Text("SLEEP").font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted)
                Text(o?.asleep ?? "No data").font(.subheadline.weight(.semibold))
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text("NEXT").font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted)
                if let e = o?.nextEvent {
                    Text(e.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(Format.time(e)).font(.caption).foregroundStyle(WColor.sky)
                } else { Text("Nothing today").font(.subheadline).foregroundStyle(WColor.muted) }
            }
        }
    }

    private var moodRow: some View {
        HStack(spacing: 6) {
            Text("MOOD").font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted).frame(width: 40, alignment: .leading)
            ForEach(1 ... 5, id: \.self) { v in
                Button(intent: LogMoodIntent(value: v)) {
                    Text(["Low", "Meh", "Okay", "Good", "Great"][v - 1]).font(.system(size: 11, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity).frame(height: 36)
                        .background(moodNow == v ? AnyShapeStyle(WColor.gradient) : AnyShapeStyle(Color.white.opacity(0.08)), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var caffeineRow: some View {
        HStack(spacing: 10) {
            Text("CAFFEINE").font(.caption2.weight(.semibold)).foregroundStyle(WColor.muted)
            Text("\(Int(o?.log?.caffeine.mg ?? 0)) mg").font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit()
            Spacer(minLength: 6)
            Button(intent: LogCaffeineIntent()) {
                Label("Coffee", systemImage: "plus").font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 14).frame(height: 34).background(Color.white.opacity(0.08), in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private var allTaken: Bool { !supplements.isEmpty && supplements.allSatisfy { taken.contains($0.lowercased()) } }

    // One button: take everything, or (once everything is taken) undo it. Odd mixes are done in the app.
    private var supplementBlock: some View {
        let count = supplements.filter { taken.contains($0.lowercased()) }.count
        return Button(intent: ToggleSupplementsIntent()) {
            HStack(spacing: 8) {
                Image(systemName: allTaken ? "checkmark.circle.fill" : "circle").font(.system(size: 16))
                VStack(alignment: .leading, spacing: 0) {
                    Text(allTaken ? "All supplements taken" : "Take all supplements").font(.system(size: 14, weight: .semibold))
                    Text(allTaken ? "Tap to undo" : "\(count) of \(supplements.count) taken").font(.caption2).foregroundStyle(allTaken ? Color.white.opacity(0.7) : WColor.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).frame(maxWidth: .infinity).frame(height: 48)
            .background(allTaken ? AnyShapeStyle(WColor.good.opacity(0.30)) : AnyShapeStyle(Color.white.opacity(0.10)), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct LargeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeStackLarge", provider: LargeProvider()) { LargeWidgetView(entry: $0) }
            .configurationDisplayName("Today, large")
            .description("Sleep, your next event, and tap-to-log mood, coffee and supplements.")
            .supportedFamilies([.systemLarge])
    }
}
