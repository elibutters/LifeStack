import SwiftUI

private let moodLabels = [1: "Low", 2: "Meh", 3: "Okay", 4: "Good", 5: "Great"]

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var tapped = 0
    @State private var editingDoses = false
    @State private var pickingDay = false

    private var drinks: [LogOptions.Drink] { model.options?.caffeine ?? [] }
    private var takenCount: Int { (model.options?.supplements ?? []).filter { model.taken($0.name) != nil }.count }
    private let two = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        Screen(title: "Log", refresh: { await model.refresh() }, trailing: {
            if !model.isToday {
                Button("Today") { Task { await model.showDay(.now) } }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.warm).buttonStyle(.plain).accessibilityIdentifier("log-today")
            }
        }) {
            ErrorBanner(text: model.message)
            dayBar
            summary
            moodCard
            caffeineCard
            supplementCard
            todayList
        }
        .sheet(isPresented: $editingDoses) { DoseEditor(supplements: model.options?.supplements ?? []) }
        .sheet(isPresented: $pickingDay) { DayPicker(start: model.shownDay) }
        .sensoryFeedback(.success, trigger: tapped)
        .task { await model.refresh() }
    }

    private var dayName: String {
        if model.isToday { return "Today" }
        if Calendar.current.isDateInYesterday(model.shownDay) { return "Yesterday" }
        return Format.longDay(model.shownDay)
    }

    // Which day the taps below log to. Arrows step a day; the name opens a calendar to jump to any past day.
    private var dayBar: some View {
        HStack(spacing: 6) {
            Button { Task { await model.shiftDay(-1) } } label: { Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 40) }
                .buttonStyle(.plain).accessibilityLabel("Previous day").accessibilityIdentifier("log-prev-day")
            Button { pickingDay = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").font(.subheadline).foregroundStyle(model.isToday ? Theme.muted : Theme.warm)
                    Text(dayName).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.plain).accessibilityLabel("Logging for \(dayName). Pick a day").accessibilityIdentifier("log-day")
            if model.isToday {
                Image(systemName: "chevron.right").font(.body.weight(.semibold)).foregroundStyle(Theme.muted.opacity(0.4)).frame(width: 44, height: 40)
            } else {
                Button { Task { await model.shiftDay(1) } } label: { Image(systemName: "chevron.right").font(.body.weight(.semibold)).frame(width: 44, height: 40) }
                    .buttonStyle(.plain).accessibilityLabel("Next day").accessibilityIdentifier("log-next-day")
            }
        }
        .foregroundStyle(Theme.sky)
        .padding(.horizontal, 4)
        .chip(model.isToday ? nil : Theme.warm.opacity(0.25))
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

    // The shown day's entries for one drink. The drink is the start of the entry's label, as in "Coffee (95 mg)".
    private func drinkEntries(_ drink: String) -> [HistoryEntry] {
        (model.today?.entries ?? []).filter { $0.key == "caffeine" && $0.drinkName.caseInsensitiveCompare(drink) == .orderedSame }
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
                    let taken = model.taken(s.name) != nil
                    Button { if model.toggleSupplement(s) { tapped += 1 } } label: {
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
                }
            }
            if !(model.options?.supplements ?? []).isEmpty {
                HStack {
                    if takenCount > 0, takenCount == (model.options?.supplements.count ?? 0) {
                        Button("Remove all") { model.removeAllSupplements(); tapped += 1 }
                            .font(.footnote.weight(.medium)).foregroundStyle(Theme.accent).buttonStyle(.plain)
                            .accessibilityIdentifier("remove-all-supplements")
                    } else if takenCount < (model.options?.supplements.count ?? 0) {
                        Button("Select all") { model.takeAllSupplements(); tapped += 1 }
                            .font(.footnote.weight(.medium)).foregroundStyle(Theme.accent).buttonStyle(.plain)
                            .accessibilityIdentifier("select-all-supplements")
                    }
                    Spacer(minLength: 8)
                    Button("Edit doses") { editingDoses = true }
                        .font(.footnote.weight(.medium)).foregroundStyle(Theme.accent).buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private var todayList: some View {
        let rows = Array((model.today?.entries ?? []).reversed())
        if !rows.isEmpty {
            Card(title: model.isToday ? "Logged today" : "Logged \(dayName == "Yesterday" ? "yesterday" : "that day")", trailing: "\(rows.count)") {
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

// A calendar to jump to any past day. Picking a day shows it and closes the sheet.
private struct DayPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date

    init(start: Date) { _date = State(initialValue: start) }

    var body: some View {
        NavigationStack {
            DatePicker("Day", selection: $date, in: ...Date.now, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .tint(Theme.sky)
                .padding(14)
                .onChange(of: date) { _, d in Task { await model.showDay(d) }; dismiss() }
                .navigationTitle("Log for").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Today") { Task { await model.showDay(.now) }; dismiss() } }
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .background(Ambient())
        }
        .presentationDetents([.medium, .large])
    }
}
