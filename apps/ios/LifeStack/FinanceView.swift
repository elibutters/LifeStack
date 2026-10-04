import SwiftUI

struct FinanceView: View {
    @Environment(AppModel.self) private var model
    @State private var summary = Loader<FinanceSummary>()
    @State private var txns = Loader<[Transaction]>()
    @State private var holdings = Loader<[Holding]>()

    var body: some View {
        NavigationStack {
            List {
                ErrorRow(text: summary.error)
                if let s = summary.value {
                    Section("Net worth") {
                        Text(Format.money(s.netWorth.net)).font(.largeTitle.weight(.semibold))
                        HStack { Stat(label: "Assets", value: Format.money(s.netWorth.assets)); Stat(label: "Owed", value: Format.money(s.netWorth.liabilities)) }
                    }
                    Section(s.thisMonth.month) {
                        HStack { Stat(label: "In", value: Format.money(s.thisMonth.income)); Stat(label: "Out", value: Format.money(s.thisMonth.spending)); Stat(label: "Net", value: Format.money(s.thisMonth.net)) }
                        ForEach((s.thisMonth.byCategory ?? []).prefix(5)) { c in LabeledContent(c.label, value: Format.money(c.amount)) }
                    }
                    if !s.insights.isEmpty { Section("Insights") { ForEach(s.insights) { InsightRow(insight: $0) } } }
                    ForEach(s.groups) { g in
                        Section(g.label) {
                            ForEach(g.accounts) { a in LabeledContent(a.name, value: a.balance.map { Format.money($0, cents: true) } ?? "-") }
                            LabeledContent("Total", value: Format.money(g.total)).bold()
                        }
                    }
                } else if summary.loading { Section { ProgressView() } }
                if let h = holdings.value, !h.isEmpty {
                    Section("Holdings") { ForEach(h) { x in LabeledContent(x.symbol ?? x.name ?? "Position", value: Format.money(x.value)) } }
                }
                if let t = txns.value, !t.isEmpty {
                    Section("Recent transactions") {
                        ForEach(t) { x in
                            HStack { VStack(alignment: .leading) { Text(x.merchant); Text(Format.shortDay(x.date)).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(Format.money(-x.amount, cents: true)).foregroundStyle(x.amount < 0 ? .green : .primary) }
                        }
                    }
                }
            }
            .screenHeader("Finance")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        async let a: Void = summary.load(model) { try await $0.finance() }
        async let b: Void = txns.load(model) { try await $0.transactions() }
        async let c: Void = holdings.load(model) { try await $0.holdings() }
        _ = await (a, b, c)
    }
}
