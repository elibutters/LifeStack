import AppIntents
import SwiftUI
import WidgetKit

struct LargeEntry: TimelineEntry {
    let date: Date
    let overview: Overview?
    let options: LogOptions?
    let workouts: WorkoutsOverview?
    let signedIn: Bool
    var menu: String? = nil // which dropdown-style picker is open, if any
}

struct LargeProvider: TimelineProvider {
    private static let weeks = [URLQueryItem(name: "weeks", value: "8"), URLQueryItem(name: "recent", value: "1")]
    private func load() async -> LargeEntry {
        let justTapped = WidgetData.showingOptimistic
        async let o = WidgetData.load(Overview.self, path: "api/v1/overview", cacheOnly: justTapped)
        async let l = WidgetData.load(LogOptions.self, path: "api/v1/log/options", maxAge: 60 * 60)
        async let w = WidgetData.load(WorkoutsOverview.self, path: "api/v1/workouts", query: Self.weeks, maxAge: 15 * 60)
        let (ov, lo, wo) = await (o, l, w)
        return LargeEntry(date: .now, overview: ov.value, options: lo.value, workouts: wo.value, signedIn: ov.signedIn, menu: WidgetData.openMenu)
    }
    func placeholder(in context: Context) -> LargeEntry { LargeEntry(date: .now, overview: nil, options: nil, workouts: nil, signedIn: true) }
    func getSnapshot(in context: Context, completion: @escaping (LargeEntry) -> Void) { Task { completion(await load()) } }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LargeEntry>) -> Void) {
        Task {
            let now = await load()
            // An open picker closes itself after 20 seconds, so the widget gets a second, collapsed entry for then.
            var entries = [now]
            if now.menu != nil { entries.append(LargeEntry(date: .now.addingTimeInterval(21), overview: now.overview, options: now.options, workouts: now.workouts, signedIn: now.signedIn)) }
            completion(Timeline(entries: entries, policy: .after(.now.addingTimeInterval(WidgetData.refresh))))
        }
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
                VStack(alignment: .leading, spacing: entry.menu == "supps" ? 8 : 12) {
                    header
                    logBlock
                    supplementBlock
                    Spacer(minLength: 0)
                    if entry.menu != "supps" { Text(String(format: "%.1f mi this week \u{00B7} %d week streak", week, entry.workouts?.streakWeeks ?? 0)).font(.caption).foregroundStyle(WColor.muted) }
                }
            }
        }
        .containerBackground(for: .widget) { WColor.bg }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                Ring(fraction: (o?.score ?? 0) / 100, width: 6)
                Text(o?.score.map { String(Int($0.rounded())) } ?? "-").font(.system(size: 18, weight: .semibold)).monospacedDigit()
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

    private static let moodNames = ["Low", "Meh", "Okay", "Good", "Great"]
    private var pill: Color { Color.white.opacity(0.08) }
    private var showingMood: Bool { entry.menu == "mood" }

    private var drinks: [(drink: String, mg: Double)] {
        let from = entry.options?.caffeine.map { ($0.drink, $0.mg) } ?? []
        return from.isEmpty ? [("Coffee", 95), ("Cold brew", 200), ("Energy drink", 200)] : from
    }

    // Mood and caffeine side by side. They share one panel underneath: caffeine's drinks by default, or mood's five choices
    // after tapping Mood (it falls back to caffeine on its own after a few seconds).
    private var logBlock: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                tab(title: "MOOD", value: moodNow.map { Self.moodNames[max(0, min(4, $0 - 1))] } ?? "Log", name: "mood", selected: showingMood,
                    tint: moodNow.map { WColor.mood($0).opacity(0.85) })
                tab(title: "CAFFEINE", value: "\(Int(o?.log?.caffeine.mg ?? 0)) mg", name: "drink", selected: !showingMood, tint: nil)
            }
            if showingMood {
                HStack(spacing: 5) {
                    ForEach(1 ... 5, id: \.self) { v in
                        Button(intent: LogMoodIntent(value: v)) {
                            Text(Self.moodNames[v - 1]).font(.system(size: 11, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7)
                                .frame(maxWidth: .infinity).frame(height: 34)
                                .background(moodNow == v ? AnyShapeStyle(WColor.mood(v).opacity(0.85)) : AnyShapeStyle(pill), in: RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else {
                HStack(spacing: 5) {
                    Button(intent: UndoCaffeineIntent()) {
                        Image(systemName: "minus").font(.system(size: 13, weight: .semibold)).frame(width: 40, height: 34).background(pill, in: RoundedRectangle(cornerRadius: 4))
                    }
                    .buttonStyle(.plain)
                    ForEach(drinks.prefix(5), id: \.drink) { d in
                        Button(intent: LogDrinkIntent(drink: d.drink, mg: d.mg)) {
                            Text("+ " + (d.drink == "Energy drink" ? "Energy" : d.drink)).font(.system(size: 11, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7)
                                .frame(maxWidth: .infinity).frame(height: 34).background(pill, in: RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func tab(title: String, value: String, name: String, selected: Bool, tint: Color?) -> some View {
        Button(intent: TogglePickerIntent(name: name)) {
            HStack(spacing: 8) {
                Text(title).font(.caption2.weight(.semibold)).foregroundStyle(selected ? Color.white.opacity(0.85) : WColor.muted)
                Text(value).font(.system(size: 14, weight: .semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                Image(systemName: selected ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .semibold))
            }
            .padding(.horizontal, 12).frame(maxWidth: .infinity).frame(height: 38)
            .background(tint.map { AnyShapeStyle($0) } ?? AnyShapeStyle(Color.white.opacity(selected ? 0.16 : 0.08)), in: RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
    }

    private var allTaken: Bool { !supplements.isEmpty && supplements.allSatisfy { taken.contains($0.lowercased()) } }

    // The big button takes everything (or, once everything is taken, undoes it); the chevron opens a list to tick just some.
    private var supplementBlock: some View {
        let count = supplements.filter { taken.contains($0.lowercased()) }.count
        return VStack(spacing: 6) {
            HStack(spacing: 6) {
                Button(intent: ToggleSupplementsIntent()) {
                    HStack(spacing: 8) {
                        Image(systemName: allTaken ? "checkmark.circle.fill" : "circle").font(.system(size: 16))
                        VStack(alignment: .leading, spacing: 0) {
                            Text(allTaken ? "All supplements taken" : "Take all supplements").font(.system(size: 14, weight: .semibold))
                            Text(allTaken ? "Tap to undo" : "\(count) of \(supplements.count) taken").font(.caption2).foregroundStyle(allTaken ? Color.white.opacity(0.7) : WColor.muted)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14).frame(maxWidth: .infinity).frame(height: 48)
                    .background(allTaken ? AnyShapeStyle(WColor.good.opacity(0.18)) : AnyShapeStyle(pill), in: RoundedRectangle(cornerRadius: 4))
                }
                .buttonStyle(.plain)
                Button(intent: TogglePickerIntent(name: "supps")) {
                    Image(systemName: entry.menu == "supps" ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .semibold)).frame(width: 40, height: 48).background(pill, in: RoundedRectangle(cornerRadius: 4))
                }
                .buttonStyle(.plain)
            }
            if entry.menu == "supps" {
                let rows = stride(from: 0, to: supplements.count, by: 3).map { Array(supplements[$0 ..< min($0 + 3, supplements.count)]) }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 5) {
                        ForEach(row, id: \.self) { name in
                            let on = taken.contains(name.lowercased())
                            Button(intent: ToggleSupplementIntent(name: name)) {
                                HStack(spacing: 4) {
                                    Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.system(size: 11))
                                    Text(name).font(.system(size: 11, weight: .medium)).lineLimit(1).minimumScaleFactor(0.6)
                                }
                                .frame(maxWidth: .infinity).frame(height: 30)
                                .background(on ? AnyShapeStyle(WColor.good.opacity(0.18)) : AnyShapeStyle(pill), in: RoundedRectangle(cornerRadius: 4))
                            }
                            .buttonStyle(.plain)
                        }
                        if row.count < 3 { ForEach(0 ..< 3 - row.count, id: \.self) { _ in Color.clear.frame(maxWidth: .infinity, maxHeight: 1) } }
                    }
                }
            }
        }
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
