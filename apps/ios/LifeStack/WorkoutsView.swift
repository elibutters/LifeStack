import Charts
import SwiftUI

struct WorkoutsView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<WorkoutsOverview>()
    @State private var pickedWeek: String?
    @State private var pickedRun: String?
    @State private var pickedDay: String?

    var body: some View {
        Screen(title: "Workouts", refresh: { await load() }) {
            ErrorBanner(text: loader.error)
            if let o = loader.value {
                if o.totals.all.count == 0 {
                    Card { Empty(text: "No workouts yet. Connect Strava on the web app's Connections page and they appear here.") }
                } else {
                    totals(o)
                    weekly(o)
                    consistency(o)
                    pace(o)
                    records(o)
                    recent(o)
                }
            } else if loader.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
    }

    private func load() async { await loader.load(model) { try await $0.workouts() } }

    private func tile(_ label: String, _ t: WorkoutTotals) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(.caption2.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted)
            Text(Format.milesText(t.distanceM, digits: t.distanceM > 160_000 ? 0 : 1)).font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit().minimumScaleFactor(0.7).lineLimit(1)
            Text("\(t.count) workout\(t.count == 1 ? "" : "s") \u{00B7} \(Format.duration(t.movingS))").font(.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
            Text(t.paceSecPerKm.map { "\(Format.paceText($0)) avg" } ?? " ").font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: Theme.r))
    }

    private func totals(_ o: WorkoutsOverview) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) { tile("Last 7 days", o.totals.last7); tile("Last 28 days", o.totals.last28) }
            HStack(spacing: 10) { tile("This year", o.totals.ytd); tile("All time", o.totals.all) }
        }
    }

    private func weekLabel(_ s: String) -> String { Format.shortDay(s) }

    private func weekly(_ o: WorkoutsOverview) -> some View {
        let avg = o.weeks.isEmpty ? 0 : o.weeks.map { Format.miles($0.distanceM) }.reduce(0, +) / Double(o.weeks.count)
        return Card(title: "Miles per week", trailing: "\(o.weeks.count) weeks") {
            Chart {
                ForEach(o.weeks) { w in
                    BarMark(x: .value("Week", w.weekStart), y: .value("Miles", Format.miles(w.distanceM))).foregroundStyle(Theme.accent).cornerRadius(3)
                }
                RuleMark(y: .value("Average", avg)).foregroundStyle(Theme.muted).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .annotation(position: .top, alignment: .trailing) { Text("avg \(Int(avg.rounded()))").font(.caption2).foregroundStyle(Theme.muted) }
                SelectionMark(x: pickedWeek, lines: o.weeks.first { $0.weekStart == pickedWeek }.map { ["Week of " + Format.shortDay($0.weekStart), Format.milesText($0.distanceM), "\($0.count) workout\($0.count == 1 ? "" : "s")"] } ?? [])
            }
            .chartXSelection(value: $pickedWeek)
            .chartXAxis(.hidden)
            .chartYAxis { AxisMarks(position: .leading) { _ in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel().foregroundStyle(Theme.muted) } }
            .frame(height: 150)
        }
    }

    // Twelve weeks by seven days, Monday on top; darker is farther.
    private func consistency(_ o: WorkoutsOverview) -> some View {
        let cells = o.heatmap
        let first = cells.first.flatMap { Format.dayDate($0.date) } ?? Date()
        let lead = (Calendar(identifier: .iso8601).component(.weekday, from: first) + 5) % 7  // Monday = 0
        let slots: [WorkoutCell?] = Array(repeating: nil, count: lead) + cells.map { Optional($0) }
        let columns = stride(from: 0, to: slots.count, by: 7).map { Array(slots[$0 ..< min($0 + 7, slots.count)]) }
        let top = max(cells.map(\.distanceM).max() ?? 1, 1)
        return Card(title: "Consistency", trailing: "\(o.streakWeeks) week\(o.streakWeeks == 1 ? "" : "s") in a row") {
            HStack(spacing: 4) {
                ForEach(Array(columns.enumerated()), id: \.offset) { _, col in
                    VStack(spacing: 4) {
                        ForEach(0 ..< 7, id: \.self) { i in
                            let c = i < col.count ? col[i] : nil
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(c == nil ? Color.clear : (c!.count == 0 ? Theme.raised : Theme.blue.opacity(0.35 + 0.65 * min(1, c!.distanceM / top))))
                                .frame(width: 21, height: 21)
                                .overlay { if let c, pickedDay == c.date { RoundedRectangle(cornerRadius: 3, style: .continuous).stroke(Color.white, lineWidth: 1.5) } }
                                .contentShape(Rectangle())
                                .onTapGesture { if let c { pickedDay = pickedDay == c.date ? nil : c.date } }
                                .accessibilityLabel(c.map { "\(Format.shortDay($0.date)), \($0.count == 0 ? "rest" : Format.milesText($0.distanceM))" } ?? "")
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            Text(cells.first { $0.date == pickedDay }.map { "\(Format.shortDay($0.date)): " + ($0.count == 0 ? "rest" : "\(Format.milesText($0.distanceM)), \($0.count) workout\($0.count == 1 ? "" : "s")") } ?? "Tap a day to see it")
                .font(.caption).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
        }
    }

    private func pace(_ o: WorkoutsOverview) -> some View {
        let pts = o.pace.suffix(60)
        let secPerMile = { (p: PacePoint) in p.paceSecPerKm * Format.metersPerMile / 1000 }
        return Card(title: "Pace per run", trailing: "faster is higher") {
            if pts.count < 2 { Empty(text: "Needs at least two runs of 2 miles or more.") }
            else {
                Chart(Array(pts)) { p in
                    LineMark(x: .value("Date", p.date), y: .value("Pace", secPerMile(p))).foregroundStyle(Theme.blue.opacity(0.45)).interpolationMethod(.monotone)
                    PointMark(x: .value("Date", p.date), y: .value("Pace", secPerMile(p))).foregroundStyle(Theme.sky).symbolSize(30)
                    SelectionMark(x: pickedRun, lines: pts.first { $0.date == pickedRun }.map { [Format.shortDay($0.date), Format.paceText($0.paceSecPerKm), Format.milesText($0.distanceM)] } ?? [])
                }
                .chartXSelection(value: $pickedRun)
                .chartXAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false, reversed: true))
                .chartYAxis { AxisMarks(position: .leading) { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text("\(Int(d) / 60):\(String(format: "%02d", Int(d) % 60))").foregroundStyle(Theme.muted) } } } }
                .frame(height: 150)
            }
        }
    }

    private func records(_ o: WorkoutsOverview) -> some View {
        Card(title: "Records") {
            row("Longest run", o.records.longest.map { Format.milesText($0.distanceM) }, o.records.longest.map { Format.shortDay($0.date) })
            Divider().overlay(Theme.line)
            row("Fastest pace (2 mi+)", o.records.fastest.map { Format.paceText($0.paceSecPerKm) }, o.records.fastest.map { Format.shortDay($0.date) })
            Divider().overlay(Theme.line)
            row("Biggest week", o.records.biggestWeek.map { Format.milesText($0.distanceM) }, o.records.biggestWeek.map { "week of " + Format.shortDay($0.period) })
            Divider().overlay(Theme.line)
            row("Biggest month", o.records.biggestMonth.map { Format.milesText($0.distanceM, digits: 0) }, o.records.biggestMonth?.period)
        }
    }

    private func row(_ label: String, _ value: String?, _ sub: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(Theme.muted)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(value ?? "-").font(.subheadline.weight(.semibold)).monospacedDigit()
                if let sub { Text(sub).font(.caption2).foregroundStyle(Theme.muted) }
            }
        }
    }

    private func recent(_ o: WorkoutsOverview) -> some View {
        Card(title: "Recent", trailing: "\(o.totals.all.count) total") {
            VStack(spacing: 0) {
                ForEach(o.recent) { w in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(w.name ?? w.sport).font(.subheadline.weight(.medium)).lineLimit(1)
                            Text("\(Format.shortDay(w.date)) \u{00B7} \(w.sport)").font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Format.milesText(w.distanceM, digits: 2)).font(.subheadline.weight(.semibold)).monospacedDigit()
                            Text([Format.duration(w.movingS), w.sport.contains("Run") && w.distanceM > 0 ? Format.paceText(w.movingS / (w.distanceM / 1000)) : nil, w.avgHr.map { "\(Int($0.rounded())) bpm" }].compactMap { $0 }.joined(separator: " \u{00B7} "))
                                .font(.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                    .padding(.vertical, 8)
                    if w.id != o.recent.last?.id { Divider().overlay(Theme.line) }
                }
            }
        }
    }
}
