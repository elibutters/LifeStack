import Charts
import SwiftUI

struct FinanceView: View {
    @Environment(AppModel.self) private var model
    @State private var summary = Loader<FinanceSummary>()
    @State private var txns = Loader<[Transaction]>()
    @State private var holdings = Loader<[Holding]>()

    var body: some View {
        Screen(title: "Finance", refresh: { await load() }) {
            ErrorBanner(text: summary.error)
            if let s = summary.value {
                Card(title: "Net worth") {
                    Big(text: Format.money(s.netWorth.net), size: 46)
                    HStack { Stat(label: "Assets", value: Format.money(s.netWorth.assets), tint: Theme.good); Stat(label: "Owed", value: Format.money(s.netWorth.liabilities)) }
                }
                Card(title: "Cash flow", trailing: "last 6 months") {
                    Chart {
                        ForEach(s.cashflow) { f in
                            BarMark(x: .value("Month", Format.monthShort(f.month)), y: .value("Amount", f.income)).position(by: .value("Type", "In")).foregroundStyle(Theme.good).cornerRadius(4)
                            BarMark(x: .value("Month", Format.monthShort(f.month)), y: .value("Amount", f.spending)).position(by: .value("Type", "Out")).foregroundStyle(Theme.violet).cornerRadius(4)
                        }
                    }
                    .chartYAxis { AxisMarks { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text(Format.money(d)).foregroundStyle(Theme.muted) } } } }
                    .chartXAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(Theme.muted) } }
                    .frame(height: 170)
                    HStack(spacing: 16) { legend(Theme.good, "Money in"); legend(Theme.violet, "Money out") }
                }
                Card(title: "Spending this month", trailing: Format.money(s.thisMonth.spending)) {
                    let rows = (s.thisMonth.byCategory ?? []).prefix(6).map { (label: $0.label, value: $0.amount) }
                    if rows.isEmpty { Empty(text: "Nothing spent yet this month.") } else { BarList(rows: Array(rows)) }
                }
                if !s.insights.isEmpty { Card(title: "Insights") { ForEach(s.insights) { InsightRow(insight: $0) } } }
                ForEach(s.groups) { g in
                    Card(title: g.label, trailing: Format.money(g.total)) {
                        ForEach(g.accounts) { a in
                            HStack { VStack(alignment: .leading, spacing: 1) { Text(a.name).font(.subheadline); if let i = a.institution { Text(i).font(.caption).foregroundStyle(Theme.muted) } }; Spacer(); Text(a.balance.map { Format.money($0, cents: true) } ?? "-").font(.subheadline.weight(.medium)).monospacedDigit() }
                        }
                    }
                }
            } else if summary.loading { ProgressView().padding(.top, 60) }
            if let h = holdings.value, !h.isEmpty {
                Card(title: "Holdings") {
                    ForEach(h) { x in HStack { Text(x.symbol ?? x.name ?? "Position").font(.subheadline.weight(.medium)); Spacer(); Text(Format.money(x.value)).font(.subheadline).monospacedDigit() } }
                }
            }
            if let t = txns.value, !t.isEmpty {
                Card(title: "Recent transactions") {
                    VStack(spacing: 0) {
                        ForEach(t) { x in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) { Text(x.merchant).font(.subheadline).lineLimit(1); Text(Format.shortDay(x.date)).font(.caption).foregroundStyle(Theme.muted) }
                                Spacer()
                                Text(Format.money(-x.amount, cents: true)).font(.subheadline.weight(.medium)).monospacedDigit().foregroundStyle(x.amount < 0 ? Theme.good : .white)
                            }
                            .padding(.vertical, 8)
                            if x.id != t.last?.id { Divider().overlay(Theme.line) }
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func legend(_ c: Color, _ t: String) -> some View { HStack(spacing: 6) { Circle().fill(c).frame(width: 8, height: 8); Text(t).font(.caption).foregroundStyle(Theme.muted) } }

    private func load() async {
        async let a: Void = summary.load(model) { try await $0.finance() }
        async let b: Void = txns.load(model) { try await $0.transactions() }
        async let c: Void = holdings.load(model) { try await $0.holdings() }
        _ = await (a, b, c)
    }
}
