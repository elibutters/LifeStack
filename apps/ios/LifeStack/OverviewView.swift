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
        NavigationStack {
            List {
                ErrorRow(text: loader.error)
                if let o = loader.value {
                    if let cal = o.calendar {
                        Section("Today") {
                            if cal.today.isEmpty {
                                Text(cal.failed ? "Could not load events." : cal.connected ? "Nothing scheduled today." : "Calendar not connected yet.").foregroundStyle(.secondary)
                            }
                            ForEach(cal.today) { EventRow(item: $0) }
                        }
                        if !cal.soon.isEmpty {
                            Section("Coming up") { ForEach(cal.soon.prefix(5)) { i in VStack(alignment: .leading) { Text(Format.dayHeading(i)).font(.caption).foregroundStyle(.secondary); EventRow(item: i) } } }
                        }
                    }
                    if let sleep = o.sleep {
                        Section("Last night") {
                            if let n = sleep.lastNight {
                                HStack { Stat(label: "Score", value: n.score.map { String(Int($0.rounded())) } ?? "-"); Stat(label: "Asleep", value: Format.minutes(n.sleepMin)); Stat(label: "Deep", value: Format.minutes(n.deepMin)); Stat(label: "REM", value: Format.minutes(n.remMin)) }
                            } else { Text(sleep.connected ? "No nights imported yet." : "Sleep not connected yet.").foregroundStyle(.secondary) }
                        }
                    }
                    if let f = o.finance {
                        Section("Money") {
                            HStack { Stat(label: "Net worth", value: Format.money(f.netWorth.net)); Stat(label: "Spent this month", value: Format.money(f.thisMonth.spending)) }
                            ForEach(f.insights) { InsightRow(insight: $0) }
                        }
                    }
                    if let t = o.log {
                        Section("Logged today") {
                            LabeledContent("Mood", value: t.mood.map { "\($0.value)" } ?? "Not logged")
                            LabeledContent("Caffeine", value: t.caffeine.count == 0 ? "None" : "\(Int(t.caffeine.mg)) mg")
                        }
                    }
                } else if loader.loading { Section { ProgressView() } }
            }
            .screenHeader(greeting) {
                Button { showAccount = true } label: { Image(systemName: "person.crop.circle").font(.title2) }.accessibilityLabel("Account").accessibilityIdentifier("account-button")
            }
            .sheet(isPresented: $showAccount) { AccountView(dismiss: { showAccount = false }) }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async { await loader.load(model) { try await $0.overview() } }
}
