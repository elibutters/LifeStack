import SwiftUI

struct OverviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(Navigator.self) private var nav
    @State private var loader = Loader<Overview>()
    @State private var syncIssues: [String] = []
    @State private var brief: Brief?

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
    }

    var body: some View {
        Screen(title: greeting, refresh: { await load() }) {
            ErrorBanner(text: loader.error)
            LiveCard()
            if let brief { BriefCard(brief: brief) }
            if !syncIssues.isEmpty {
                Card(title: "Needs a look") {
                    ForEach(syncIssues, id: \.self) { Text($0).font(.subheadline).foregroundStyle(Theme.warm) }
                }
                .accessibilityIdentifier("sync-health")
            }
            if let o = loader.value {
                if let cal = o.calendar {
                    Button { nav.tab = .calendar } label: { calendarCard(cal) }
                        .buttonStyle(.plain).accessibilityIdentifier("calendar-card").accessibilityHint("Opens Calendar")
                }
                if let sleep = o.sleep {
                    // Tapping the card opens the Sleep screen; Back returns here.
                    Button { nav.open(.sleep, from: .overview) } label: { sleepCard(sleep) }
                        .buttonStyle(.plain).accessibilityIdentifier("sleep-card").accessibilityHint("Opens Sleep")
                }
                if let f = o.finance, !f.insights.isEmpty {
                    Button { nav.open(.finance, from: .overview) } label: { moneyCard(f) }
                        .buttonStyle(.plain).accessibilityIdentifier("finance-card").accessibilityHint("Opens Finance")
                }
                if let t = o.log { logCard(t) }
            } else if loader.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
    }

    private func load() async {
        async let issues: Void = loadSyncIssues()
        async let briefLoad: Void = loadBrief()
        await loader.load(model) { try await $0.overview() }
        await issues
        await briefLoad
    }

    private func loadBrief() async {
        guard let client = model.client else { return }
        // A failed request keeps what is on screen; a good answer with no brief clears it.
        do { brief = try await client.brief() } catch {}
    }

    // A source that has gone quiet (or is failing) is worth saying so on the home screen; a fresh one with a passing warning is not.
    private func loadSyncIssues() async {
        guard let client = model.client, let c = try? await client.connections(), let h = c.health else { return }
        syncIssues = h.sources.filter { $0.health != "ok" && $0.health != "warning" }.compactMap(\.message)
    }

    private func calendarCard(_ cal: Overview.Calendar) -> some View {
        Card(title: "Today", trailing: Format.longDay(Date())) {
            if cal.today.isEmpty { Empty(text: cal.failed ? "Could not load events." : cal.connected ? "Nothing scheduled today." : "Calendar not connected yet.") }
            ForEach(cal.today) { EventRow(item: $0) }
        }
    }

    private func sleepCard(_ sleep: Overview.Sleep) -> some View {
        Card(title: "Last night") {
            if let n = sleep.lastNight {
                HStack(spacing: 20) {
                    ScoreRing(score: n.score, size: 104)
                    VStack(alignment: .leading, spacing: 12) {
                        Stat(label: "Asleep", value: Format.minutes(n.sleepMin))
                        HStack { Stat(label: "HRV", value: n.hrv.map { String(Int($0.rounded())) } ?? "-"); Stat(label: "Resp", value: n.respiratoryAvg.map { String(format: "%.1f", $0) } ?? "-") }
                    }
                }
                StageBar(night: n)
            } else { Empty(text: sleep.connected ? "No nights imported yet." : "Sleep not connected yet.") }
        }
    }

    private func moneyCard(_ f: Overview.Finance) -> some View {
        Card(title: "Spending") {
            ForEach(f.insights) { InsightRow(insight: $0) }
        }
    }

    private func logCard(_ t: TodaySummary) -> some View {
        Card(title: "Logged today") {
            HStack {
                Stat(label: "Mood", value: t.mood.map { "\($0.value)" } ?? "-")
                Stat(label: "Caffeine", value: t.caffeine.count == 0 ? "-" : "\(Int(t.caffeine.mg)) mg")
                Stat(label: "Supplements", value: "\(t.supplements.count)")
            }
        }
    }
}
