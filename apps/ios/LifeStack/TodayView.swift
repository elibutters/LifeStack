import SwiftUI

private let moodLabels = [1: "Low", 2: "Meh", 3: "Okay", 4: "Good", 5: "Great"]

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var tapped = 0
    @State private var editingDoses = false

    private var drinks: [LogOptions.Drink] { model.options?.caffeine ?? [] }
    private var takenCount: Int { (model.options?.supplements ?? []).filter { model.takenToday($0.name) != nil }.count }
    private let two = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        Screen(title: "Log", refresh: { await model.refresh() }) {
            ErrorBanner(text: model.message)
            summary
            moodCard
            caffeineCard
            supplementCard
            todayList
        }
        .sheet(isPresented: $editingDoses) { DoseEditor(supplements: model.options?.supplements ?? []) }
        .sensoryFeedback(.success, trigger: tapped)
        .task { await model.refresh() }
    }

    private var summary: some View {
        Card {
            HStack(alignment: .top) {
                Stat(label: "Mood", value: model.today?.mood.map { "\($0.value) \(moodLabels[$0.value] ?? "")" } ?? "None yet")
                Stat(label: "Caffeine", value: (model.today?.caffeine.count ?? 0) == 0 ? "None" : "\(Int(model.today?.caffeine.mg ?? 0)) mg")
                Stat(label: "Supplements", value: "\(takenCount) taken")
            }
        }
    }

    private var moodCard: some View {
        Card(title: "Mood") {
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { n in
                    let on = model.today?.mood?.value == n
                    Button { send(["type": "mood", "value": n], "Mood \(n) (\(moodLabels[n] ?? ""))") } label: {
                        VStack(spacing: 1) {
                            Text("\(n)").font(.system(size: 19, weight: .semibold))
                            Text(moodLabels[n] ?? "").font(.system(size: 10)).foregroundStyle(on ? .white : Theme.muted)
                        }
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .chip(on ? Theme.mood(n).opacity(0.85) : nil)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.pending)
                }
            }
        }
    }

    // Each drink is a counter for today: plus logs one, minus removes the most recent one, so a mistaken tap is undone right here.
    private var caffeineCard: some View {
        Card(title: "Caffeine", trailing: (model.today?.caffeine.count ?? 0) == 0 ? nil : "\(Int(model.today?.caffeine.mg ?? 0)) mg today") {
            VStack(spacing: 8) {
                ForEach(drinks, id: \.self) { d in
                    let entries = drinkEntries(d.drink)
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(d.drink).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
                            Text("\(Int(d.mg)) mg").font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 6)
                        Button { removeLatest(of: entries) } label: { Image(systemName: "minus").font(.body.weight(.semibold)).frame(width: 42, height: 36).chip() }
                            .buttonStyle(.plain).disabled(entries.isEmpty || model.pending).opacity(entries.isEmpty ? 0.35 : 1)
                            .accessibilityLabel("Remove one \(d.drink)").accessibilityIdentifier("drink-minus-\(d.drink)")
                        Text("\(entries.count)").font(.system(.title3).weight(.semibold)).monospacedDigit().frame(minWidth: 26)
                        Button { send(["type": "caffeine", "drink": d.drink], "\(d.drink) (\(Int(d.mg)) mg)") } label: { Image(systemName: "plus").font(.body.weight(.semibold)).frame(width: 42, height: 36).chip(Theme.blue.opacity(0.6)) }
                            .buttonStyle(.plain).disabled(model.pending)
                            .accessibilityLabel("Add one \(d.drink)").accessibilityIdentifier("drink-plus-\(d.drink)")
                    }
                    .padding(.horizontal, 12).frame(minHeight: 52)
                    .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: Theme.rs))
                }
            }
        }
    }

    // Today's entries for one drink. The drink is the start of the entry's label, as in "Coffee (95 mg)".
    private func drinkEntries(_ drink: String) -> [HistoryEntry] {
        model.history.filter { $0.key == "caffeine" && Format.isToday($0.at) && $0.drinkName.caseInsensitiveCompare(drink) == .orderedSame }
    }

    private func removeLatest(of entries: [HistoryEntry]) {
        guard let latest = entries.max(by: { (Format.date($0.at) ?? .distantPast) < (Format.date($1.at) ?? .distantPast) }) else { return }
        Task { await model.remove(latest); tapped += 1 }
    }

    private var supplementCard: some View {
        Card(title: "Supplements", trailing: "\(takenCount) of \(model.options?.supplements.count ?? 0)") {
            if (model.options?.supplements ?? []).isEmpty { Empty(text: "Add supplements on the web app and they show up here.") }
            LazyVGrid(columns: two, spacing: 8) {
                ForEach(model.options?.supplements ?? [], id: \.self) { s in
                    let taken = model.takenToday(s.name) != nil
                    Button { Task { if await model.toggleSupplement(s) { tapped += 1 } } } label: {
                        HStack(spacing: 8) {
                            Image(systemName: taken ? "checkmark.circle.fill" : "circle").font(.callout).foregroundStyle(taken ? Theme.good : Theme.muted)
                            Text(s.name).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.75)
                            Spacer(minLength: 2)
                            if let d = s.doseText { Text(d).font(.caption).foregroundStyle(Theme.muted).lineLimit(1) }
                        }
                        .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 42)
                        .chip(taken ? Theme.good.opacity(0.45) : nil)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.pending)
                }
            }
            if !(model.options?.supplements ?? []).isEmpty {
                Button("Edit doses") { editingDoses = true }
                    .font(.footnote.weight(.medium)).foregroundStyle(Theme.accent).buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    @ViewBuilder private var todayList: some View {
        let rows = model.history.filter { Format.isToday($0.at) }
        if !rows.isEmpty {
            Card(title: "Logged today", trailing: "\(rows.count)") {
                VStack(spacing: 0) {
                    ForEach(rows) { r in
                        HStack {
                            Text(r.label).font(.subheadline)
                            Spacer()
                            Text(Format.clock(r.at)).font(.caption).foregroundStyle(Theme.muted)
                            Button { Task { await model.remove(r) } } label: { Image(systemName: "trash").font(.footnote).foregroundStyle(Theme.muted).frame(width: 34, height: 34) }
                                .buttonStyle(.plain).accessibilityLabel("Remove \(r.label)")
                        }
                        .padding(.vertical, 4)
                        if r.id != rows.last?.id { Divider().overlay(Theme.line) }
                    }
                }
            }
        }
    }

    private func send(_ event: [String: Any], _ label: String) {
        Task { if await model.log(event, label: label) { tapped += 1 } }
    }
}

private extension HistoryEntry {
    var drinkName: String { name ?? String(label.split(separator: "(").first ?? "").trimmingCharacters(in: .whitespaces) }
}
