import Charts
import SwiftUI

private enum FinancePane: String, CaseIterable, Identifiable {
    case summary = "Summary", flow = "Flow", bills = "Bills", holdings = "Holdings"
    var id: String { rawValue }
}

struct FinanceView: View {
    @Environment(AppModel.self) private var model
    @State private var pane = FinancePane.summary
    @State private var summary = Loader<FinanceSummary>()
    @State private var holdings = Loader<HoldingsReport>()
    @State private var txns = Loader<[Transaction]>()
    @State private var month: String?
    @State private var query = ""
    @State private var category: String?
    @State private var pickedMonth: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        Screen(title: "Finance", refresh: { await load() }) {
            ErrorBanner(text: summary.error)
            Picker("Section", selection: $pane) {
                ForEach(FinancePane.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("finance-sections")
            if let s = summary.value {
                switch pane {
                case .summary: summaryPane(s)
                case .flow: flowPane(s)
                case .bills: billsPane(s)
                case .holdings: holdingsPane
                }
            } else if summary.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
        .onChange(of: month) { _, _ in Task { await reloadTxns() } }
        .onChange(of: category) { _, _ in Task { await reloadTxns() } }
        .onChange(of: query) { _, _ in
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await reloadTxns()
            }
        }
    }

    // MARK: Summary

    @ViewBuilder private func summaryPane(_ s: FinanceSummary) -> some View {
        Card(title: "Net worth") {
            Big(text: Format.money(s.netWorth.net), size: 46)
            HStack { Stat(label: "Assets", value: Format.money(s.netWorth.assets), tint: Theme.good); Stat(label: "Owed", value: Format.money(s.netWorth.liabilities)) }
            historyChart(s.history ?? [])
        }
        monthStats(s.thisMonth, previous: s.lastMonth)
        if !s.insights.isEmpty { Card(title: "Insights") { ForEach(s.insights) { InsightRow(insight: $0) } } }
        ForEach(s.groups) { g in
            Card(title: g.label, trailing: Format.money(g.total)) {
                ForEach(g.accounts) { a in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(a.name).font(.subheadline)
                            if let i = a.institution { Text(i).font(.caption).foregroundStyle(Theme.muted) }
                        }
                        Spacer()
                        Text(a.balance.map { Format.money($0, cents: true) } ?? "-").font(.subheadline.weight(.medium)).monospacedDigit()
                    }
                }
            }
        }
    }

    @ViewBuilder private func historyChart(_ points: [HistoryPoint]) -> some View {
        let rows = points.compactMap { p -> (Date, Double)? in Format.dayDate(p.day).map { ($0, p.value) } }
        if rows.count > 1 {
            Chart(rows, id: \.0) { row in
                LineMark(x: .value("Day", row.0), y: .value("Net worth", row.1)).foregroundStyle(Theme.accent).interpolationMethod(.linear)
            }
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { _ in AxisValueLabel().foregroundStyle(Theme.muted) } }
            .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text(Format.money(d)).foregroundStyle(Theme.muted) } } } }
            .frame(height: 140)
            Text("Last year. Cash and cards are rebuilt from transactions. Investments join from the day they were linked.")
                .font(.caption2).foregroundStyle(Theme.muted)
        }
    }

    // MARK: Flow

    @ViewBuilder private func flowPane(_ s: FinanceSummary) -> some View {
        let current = activeMonth(s)
        let shown = (s.months ?? [s.thisMonth]).first { $0.month == current } ?? s.thisMonth
        let prev = previousMonth(s, before: current)
        Card(title: "Money in and out", trailing: "last 12 months") {
            Chart {
                ForEach(s.cashflow) { f in
                    BarMark(x: .value("Month", f.month), y: .value("Amount", f.income)).position(by: .value("Type", "In")).foregroundStyle(Theme.good).cornerRadius(1)
                    BarMark(x: .value("Month", f.month), y: .value("Amount", f.spending)).position(by: .value("Type", "Out")).foregroundStyle(Theme.violet).cornerRadius(1)
                }
                SelectionMark(x: pickedMonth, lines: s.cashflow.first { $0.month == pickedMonth }.map { [Format.monthShort($0.month), "In " + Format.money($0.income), "Out " + Format.money($0.spending)] } ?? [])
            }
            .chartXSelection(value: $pickedMonth)
            .chartYAxis { AxisMarks { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text(Format.money(d)).foregroundStyle(Theme.muted) } } } }
            .chartXAxis { AxisMarks { value in AxisValueLabel { if let m = value.as(String.self) { Text(Format.monthShort(m)).font(.caption2).foregroundStyle(Theme.muted) } } } }
            .frame(height: 180)
            .onChange(of: pickedMonth) { _, picked in if let picked { month = picked; category = nil } }
            HStack(spacing: 16) { legend(Theme.good, "Money in"); legend(Theme.violet, "Money out") }
            Text("Transfers and credit card payments are left out, so nothing is counted twice.").font(.caption2).foregroundStyle(Theme.muted)
        }
        HStack {
            Text(Format.monthShort(shown.month)).font(.title3.weight(.semibold))
            Spacer()
            Button { shift(s, -1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 36) }.accessibilityLabel("Previous month")
            Button { shift(s, 1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 36) }
                .disabled(shown.month >= s.thisMonth.month)
                .accessibilityLabel("Next month")
        }
        monthStats(shown, previous: prev)
        barsCard("Spending", trailing: Format.money(shown.spending), rows: shown.byCategory ?? [], tint: Theme.violet, empty: "No spending this month.")
        barsCard("Top merchants", trailing: nil, rows: merchantRows(shown.topMerchants), tint: Theme.violet, empty: "Nothing to show.")
        barsCard("Income", trailing: Format.money(shown.income), rows: shown.incomeByCategory ?? [], tint: Theme.good, empty: "No income this month.")
        barsCard("Top sources", trailing: nil, rows: merchantRows(shown.topIncome), tint: Theme.good, empty: "Nothing to show.")
        TextField("Search merchants", text: $query)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(12).panel(Theme.rs)
            .accessibilityLabel("Search transactions")
        if category != nil {
            Button { category = nil } label: { Text("Clear category").font(.caption).foregroundStyle(Theme.accent) }
        }
        transactionsCard
    }

    private var transactionsCard: some View {
        Card(title: "Transactions") {
            if let rows = txns.value {
                if rows.isEmpty { Empty(text: "No transactions match.") }
                else {
                    VStack(spacing: 0) {
                        ForEach(rows) { x in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(x.merchant).font(.subheadline).lineLimit(1)
                                    Text(x.pending ? "\(Format.shortDay(x.date)) · pending" : Format.shortDay(x.date)).font(.caption).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Text(Format.money(-x.amount, cents: true)).font(.subheadline.weight(.medium)).monospacedDigit().foregroundStyle(x.amount < 0 ? Theme.good : .white)
                            }
                            .padding(.vertical, 8)
                            if x.id != rows.last?.id { Divider().overlay(Theme.line) }
                        }
                    }
                }
            } else if txns.loading { ProgressView() }
        }
    }

    // MARK: Bills

    @ViewBuilder private func billsPane(_ s: FinanceSummary) -> some View {
        if let r = s.recurring, !r.buckets.isEmpty {
            Card(title: "Recurring", trailing: Format.money(r.monthly) + "/mo") {
                Text("About \(Format.money(r.monthly)) a month, \(Format.money(r.monthly * 12)) a year. Yearly dues are spread across the year.").font(.caption).foregroundStyle(Theme.muted)
            }
            if r.track.contains(where: { $0.budget > 0 || $0.cash > 0 }) {
                Card(title: "Expected and posted") {
                    Chart {
                        ForEach(r.track) { m in
                            BarMark(x: .value("Month", m.month), y: .value("Amount", m.budget)).position(by: .value("Kind", "Expected")).foregroundStyle(Theme.muted).cornerRadius(1)
                            BarMark(x: .value("Month", m.month), y: .value("Amount", m.cash)).position(by: .value("Kind", "Posted")).foregroundStyle(Theme.accent).cornerRadius(1)
                        }
                    }
                    .chartYAxis { AxisMarks { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text(Format.money(d)).foregroundStyle(Theme.muted) } } } }
                    .chartXAxis { AxisMarks { value in AxisValueLabel { if let m = value.as(String.self) { Text(Format.monthShort(m)).font(.caption2).foregroundStyle(Theme.muted) } } } }
                    .frame(height: 160)
                    HStack(spacing: 16) { legend(Theme.muted, "Expected"); legend(Theme.accent, "Posted") }
                }
            }
            ForEach(r.buckets) { b in
                Card(title: b.label, trailing: Format.money(b.total) + "/mo") {
                    VStack(spacing: 0) {
                        ForEach(b.items) { item in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.name).font(.subheadline.weight(.medium))
                                    Text([item.cadence, item.on, "next \(Format.shortDay(item.nextDate))"].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Text(Format.money(item.amount, cents: true)).font(.subheadline).monospacedDigit()
                            }
                            .padding(.vertical, 8)
                            if item.id != b.items.last?.id { Divider().overlay(Theme.line) }
                        }
                    }
                }
            }
        } else {
            Card(title: "Recurring") {
                Empty(text: "Nothing is tagged yet. On the web, open Finance and then Recurring, and mark the charges that repeat. They show up here.")
            }
        }
    }

    // MARK: Holdings

    @ViewBuilder private var holdingsPane: some View {
        if let report = holdings.value {
            if let s = report.summary, s.held > 0 || !report.holdings.isEmpty {
                Card(title: "Investments") {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 14) {
                        Stat(label: "In holdings", value: Format.money(s.held))
                        Stat(label: "Cost basis", value: s.cost.map { Format.money($0) } ?? "n/a")
                        Stat(label: "Gain or loss", value: s.gain.map { Format.money($0) } ?? "n/a", tint: (s.gain ?? 0) < 0 ? Theme.bad : (s.gain ?? 0) > 0 ? Theme.good : .white)
                        Stat(label: "On known cost", value: s.gainRate.map { Format.pct($0) } ?? "n/a")
                    }
                }
                if !s.byType.isEmpty {
                    Card(title: "Allocation") { BarList(rows: s.byType.map { (label: $0.label, value: $0.value) }) }
                }
            }
            if report.holdings.isEmpty {
                Card { Empty(text: "No holdings yet. Link a brokerage, then allow investment data, and sync.") }
            } else {
                Card(title: "Positions") {
                    VStack(spacing: 0) {
                        ForEach(report.holdings) { x in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(x.symbol ?? x.name ?? "Position").font(.subheadline.weight(.medium))
                                    Text(positionDetail(x)).font(.caption).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(Format.money(x.value, cents: true)).font(.subheadline.weight(.medium)).monospacedDigit()
                                    if let g = x.gain {
                                        Text(Format.money(g, cents: true)).font(.caption).monospacedDigit().foregroundStyle(g < 0 ? Theme.bad : Theme.good)
                                    }
                                }
                            }
                            .padding(.vertical, 8)
                            if x.id != report.holdings.last?.id { Divider().overlay(Theme.line) }
                        }
                    }
                }
            }
        } else if holdings.loading { ProgressView().padding(.top, 40) }
        else if let error = holdings.error { ErrorBanner(text: error) }
    }

    // MARK: Pieces

    private func monthStats(_ m: MonthSummary, previous: MonthSummary?) -> some View {
        Card(title: Format.monthShort(m.month)) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 14) {
                statBlock("Money in", Format.money(m.income), Theme.good, change(m.income, previous?.income))
                statBlock("Money out", Format.money(m.spending), Theme.violet, change(m.spending, previous?.spending))
                statBlock("Left over", Format.money(m.net), m.net < 0 ? Theme.bad : Theme.good, nil)
                statBlock("Savings rate", m.savingsRate.map { Format.pct($0) } ?? "n/a", .white, nil)
            }
        }
    }

    private func statBlock(_ label: String, _ value: String, _ tint: Color, _ sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Stat(label: label, value: value, tint: tint)
            if let sub { Text(sub).font(.caption2).foregroundStyle(Theme.muted) }
        }
    }

    @ViewBuilder private func barsCard(_ title: String, trailing: String?, rows: [MonthSummary.Category], tint: Color, empty: String) -> some View {
        if rows.isEmpty && trailing == nil { EmptyView() } else {
            Card(title: title, trailing: trailing) {
                if rows.isEmpty { Empty(text: empty) }
                else {
                    let tappable = rows.contains { $0.category != nil }
                    BarList(rows: rows.map { (label: $0.label, value: $0.amount) }, tint: tint, onTap: tappable ? { label in
                        guard let match = rows.first(where: { $0.label == label })?.category else { return }
                        category = category == match ? nil : match
                    } : nil)
                }
            }
        }
    }

    private func merchantRows(_ rows: [MerchantTotal]?) -> [MonthSummary.Category] {
        (rows ?? []).map { MonthSummary.Category(category: nil, label: $0.name, amount: $0.amount, count: $0.count) }
    }

    private func legend(_ c: Color, _ t: String) -> some View { HStack(spacing: 6) { Circle().fill(c).frame(width: 8, height: 8); Text(t).font(.caption).foregroundStyle(Theme.muted) } }

    private func positionDetail(_ x: Holding) -> String {
        var parts = ["\(formatShares(x.quantity)) shares"]
        if x.price > 0 { parts.append(Format.money(x.price, cents: true)) }
        return parts.joined(separator: " · ")
    }

    private func formatShares(_ n: Double) -> String { n == n.rounded() ? String(Int(n)) : String(format: "%.4f", n) }

    private func change(_ now: Double, _ prev: Double?) -> String? {
        guard let prev, prev > 0 else { return nil }
        let d = (now - prev) / prev
        return "\(d >= 0 ? "up" : "down") \(Format.pct(abs(d))) vs last month"
    }

    private func activeMonth(_ s: FinanceSummary) -> String { month ?? s.thisMonth.month }

    private func previousMonth(_ s: FinanceSummary, before current: String) -> MonthSummary? {
        let list = s.months ?? []
        if let i = list.firstIndex(where: { $0.month == current }), i > 0 { return list[i - 1] }
        return current == s.thisMonth.month ? s.lastMonth : nil
    }

    private func shift(_ s: FinanceSummary, _ delta: Int) {
        let list = s.months ?? [s.thisMonth]
        guard let i = list.firstIndex(where: { $0.month == activeMonth(s) }) else { return }
        let next = i + delta
        guard list.indices.contains(next) else { return }
        month = list[next].month
        category = nil
    }

    private func load() async {
        async let a: Void = summary.load(model) { try await $0.finance() }
        async let b: Void = holdings.load(model) { try await $0.holdings() }
        _ = await (a, b)
        if month == nil { month = summary.value?.thisMonth.month }
        else { await reloadTxns() }
    }

    private func reloadTxns() async {
        let current = month ?? summary.value?.thisMonth.month
        let from = current.map(Format.monthStart)
        let to = current.flatMap(Format.monthEnd)
        await txns.load(model) { try await $0.transactions(text: query, from: from, to: to, category: category) }
    }
}
