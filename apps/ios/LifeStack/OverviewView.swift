import SwiftUI

struct OverviewView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<Overview>()
    @State private var showAccount = false

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
    }

    var body: some View {
        Screen(title: greeting, refresh: { await load() }, trailing: {
            Button { showAccount = true } label: { Image(systemName: "person.crop.circle").font(.title2).foregroundStyle(Theme.sky) }
                .accessibilityLabel("Account").accessibilityIdentifier("account-button")
        }) {
            ErrorBanner(text: loader.error)
            if let o = loader.value {
                if let cal = o.calendar { calendarCard(cal) }
                if let sleep = o.sleep { sleepCard(sleep) }
                if let f = o.finance { moneyCard(f) }
                if let t = o.log { logCard(t) }
            } else if loader.loading { ProgressView().padding(.top, 60) }
        }
        .sheet(isPresented: $showAccount) { AccountView(dismiss: { showAccount = false }) }
        .task { await load() }
    }

    private func load() async { await loader.load(model) { try await $0.overview() } }

    private func calendarCard(_ cal: Overview.Calendar) -> some View {
        Card(title: "Today", trailing: Format.longDay(Date())) {
            if cal.today.isEmpty { Empty(text: cal.failed ? "Could not load events." : cal.connected ? "Nothing scheduled today." : "Calendar not connected yet.") }
            ForEach(cal.today) { EventRow(item: $0) }
            if !cal.soon.isEmpty {
                Divider().overlay(Theme.line)
                Text("COMING UP").font(.caption2.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted)
                ForEach(cal.soon.prefix(4)) { i in
                    VStack(alignment: .leading, spacing: 2) { Text(Format.dayHeading(i)).font(.caption).foregroundStyle(Theme.muted); EventRow(item: i) }
                }
            }
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
        Card(title: "Money") {
            VStack(alignment: .leading, spacing: 4) {
                Text("Net worth").font(.caption).foregroundStyle(Theme.muted)
                Big(text: Format.money(f.netWorth.net), size: 40)
            }
            HStack {
                Stat(label: "In this month", value: Format.money(f.thisMonth.income), tint: Theme.good)
                Stat(label: "Out this month", value: Format.money(f.thisMonth.spending))
            }
            if !f.insights.isEmpty {
                Divider().overlay(Theme.line)
                ForEach(f.insights) { InsightRow(insight: $0) }
            }
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
