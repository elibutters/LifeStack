import SwiftUI

// Three ways to read the same events, in the order they are offered. Rolling is seven days starting on the
// selected day, moved one day at a time, and is where the screen opens. Month is a grid. Week is the
// calendar week around the selected day.
private enum CalendarMode: String, CaseIterable {
    case rolling = "Rolling"
    case month = "Month"
    case week = "Week"
}

struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var mode: CalendarMode = .rolling
    @State private var focus = Calendar.current.startOfDay(for: Date())
    @State private var page = Calendar.current.startOfDay(for: Date())
    @State private var items: [CalendarItem] = []
    @State private var selected: CalendarItem?
    @State private var error: String?
    @State private var loading = false
    @State private var generation = 0
    var dismiss: (() -> Void)? = nil

    private var cal: Calendar { Calendar.current }
    private var today: Date { cal.startOfDay(for: Date()) }

    var body: some View {
        Screen(title: "Calendar", refresh: { await load() }, trailing: {
            if let dismiss { Button("Done", action: dismiss).foregroundStyle(Theme.sky) }
        }) {
            ErrorBanner(text: error)
            modePicker
            pager
            switch mode {
            case .month:
                monthGrid
                dayAgenda(focus)
            case .week, .rolling:
                weekStrip(windowDays)
                windowAgenda
            }
            if items.isEmpty && loading { ProgressView().padding(.top, 24) }
        }
        .task(id: loadKey) { await load() }
        .sheet(item: $selected) { item in CalendarItemSheet(item: item) { await load() } }
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach(CalendarMode.allCases, id: \.self) { m in
                Button {
                    mode = m
                    page = focus
                } label: {
                    Text(m.rawValue).font(.subheadline.weight(mode == m ? .semibold : .regular))
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(mode == m ? Theme.raised : Color.clear)
                        .foregroundStyle(mode == m ? Color.white : Theme.muted)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(mode == m ? .isSelected : [])
            }
        }
        .panel(Theme.rs)
    }

    private var pager: some View {
        HStack(spacing: 4) {
            stepButton("chevron.left", "Previous", -1)
            Text(rangeTitle).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
            stepButton("chevron.right", "Next", 1)
            Button("Today") { focus = today; page = today }
                .font(.subheadline.weight(.medium)).foregroundStyle(Theme.accent)
                .padding(.leading, 4)
        }
    }

    private func stepButton(_ icon: String, _ label: String, _ delta: Int) -> some View {
        Button { shift(delta) } label: {
            Image(systemName: icon).font(.body.weight(.semibold)).foregroundStyle(Theme.sky).frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var monthGrid: some View {
        let cells = monthCells(page)
        let symbols = weekdaySymbols
        return Card {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                ForEach(Array(symbols.enumerated()), id: \.offset) { _, symbol in
                    Text(symbol).font(.caption2).foregroundStyle(Theme.muted).frame(maxWidth: .infinity).padding(.bottom, 6)
                }
                ForEach(cells, id: \.timeIntervalSince1970) { day in
                    dayCell(day, inMonth: cal.isDate(day, equalTo: page, toGranularity: .month))
                }
            }
        }
    }

    private func dayCell(_ day: Date, inMonth: Bool) -> some View {
        let selected = cal.isDate(day, inSameDayAs: focus)
        let marks = events(on: day).prefix(3)
        return Button { focus = day } label: {
            VStack(spacing: 4) {
                Text("\(cal.component(.day, from: day))")
                    .font(.caption.weight(cal.isDateInToday(day) ? .bold : .medium))
                    .frame(width: 22, height: 22)
                    .background(cal.isDateInToday(day) ? Theme.accent : Color.clear, in: RoundedRectangle(cornerRadius: Theme.rs))
                    .foregroundStyle(cal.isDateInToday(day) ? Color.black : inMonth ? Color.white : Theme.muted)
                HStack(spacing: 2) {
                    ForEach(Array(marks)) { item in
                        RoundedRectangle(cornerRadius: 1).fill(mark(item)).frame(width: 4, height: 4)
                    }
                }
                .frame(height: 6)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(selected ? Theme.raised : Color.clear)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month().day()))
    }

    private func weekStrip(_ days: [Date]) -> some View {
        HStack(spacing: 4) {
            ForEach(days, id: \.timeIntervalSince1970) { day in
                let selected = cal.isDate(day, inSameDayAs: focus)
                Button { focus = day } label: {
                    VStack(spacing: 4) {
                        Text(day.formatted(.dateTime.weekday(.narrow))).font(.caption2).foregroundStyle(Theme.muted)
                        Text("\(cal.component(.day, from: day))")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 28, height: 28)
                            .background(cal.isDateInToday(day) ? Theme.accent : Color.clear, in: RoundedRectangle(cornerRadius: Theme.rs))
                            .foregroundStyle(cal.isDateInToday(day) ? Color.black : Color.white)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(events(on: day).isEmpty ? Color.clear : Theme.accent.opacity(0.8))
                            .frame(width: 4, height: 4)
                    }
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(selected ? Theme.raised : Color.clear)
                }
                .buttonStyle(.plain)
            }
        }
        .panel(Theme.rs)
    }

    private var windowAgenda: some View {
        Card {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(windowDays.enumerated()), id: \.offset) { index, day in
                    if index > 0 { Divider().overlay(Theme.line).padding(.vertical, 8) }
                    dayBlock(day)
                }
            }
        }
    }

    private func dayAgenda(_ day: Date) -> some View {
        let list = events(on: day)
        return Card(title: day.formatted(.dateTime.weekday(.wide).month(.wide).day())) {
            if list.isEmpty {
                Empty(text: "Nothing scheduled.")
            } else {
                ForEach(list) { item in Button { selected = item } label: { EventRow(item: item) }.buttonStyle(.plain) }
            }
        }
    }

    private func dayBlock(_ day: Date) -> some View {
        let list = events(on: day)
        return VStack(alignment: .leading, spacing: 6) {
            Button { focus = day } label: {
                HStack(spacing: 6) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated))).foregroundStyle(cal.isDateInToday(day) ? Theme.accent : Theme.muted)
                    Text(day.formatted(.dateTime.month(.abbreviated).day())).foregroundStyle(cal.isDate(day, inSameDayAs: focus) ? Color.white : Theme.muted)
                }
                .font(.caption.weight(.semibold))
            }
            .buttonStyle(.plain)
            if list.isEmpty {
                Text("Nothing scheduled").font(.subheadline).foregroundStyle(Theme.muted)
            } else {
                ForEach(list) { item in Button { selected = item } label: { EventRow(item: item) }.buttonStyle(.plain) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var windowDays: [Date] {
        switch mode {
        case .month: monthCells(page)
        case .week: weekDays(page)
        case .rolling: (0 ..< 7).compactMap { cal.date(byAdding: .day, value: $0, to: cal.startOfDay(for: page)) }
        }
    }

    private var rangeTitle: String {
        switch mode {
        case .month:
            page.formatted(.dateTime.month(.wide).year())
        case .week, .rolling:
            span(windowDays)
        }
    }

    private var loadKey: String {
        let days = windowDays
        guard let first = days.first, let last = days.last else { return "" }
        return "\(ymd(first)):\(ymd(last))"
    }

    private func shift(_ delta: Int) {
        switch mode {
        case .month:
            guard let next = cal.date(byAdding: .month, value: delta, to: page) else { return }
            let wanted = cal.component(.day, from: focus)
            let last = cal.range(of: .day, in: .month, for: next)?.count ?? wanted
            var parts = cal.dateComponents([.year, .month], from: next)
            parts.day = min(wanted, last)
            page = cal.startOfDay(for: next)
            focus = cal.date(from: parts).map { cal.startOfDay(for: $0) } ?? page
        case .week:
            guard let next = cal.date(byAdding: .day, value: 7 * delta, to: focus) else { return }
            focus = cal.startOfDay(for: next)
            page = focus
        case .rolling:
            guard let nextPage = cal.date(byAdding: .day, value: delta, to: page),
                  let nextFocus = cal.date(byAdding: .day, value: delta, to: focus) else { return }
            page = cal.startOfDay(for: nextPage)
            focus = cal.startOfDay(for: nextFocus)
        }
    }

    private func monthCells(_ date: Date) -> [Date] {
        guard let start = cal.date(from: cal.dateComponents([.year, .month], from: date)) else { return [] }
        let lead = (cal.component(.weekday, from: start) - cal.firstWeekday + 7) % 7
        guard let gridStart = cal.date(byAdding: .day, value: -lead, to: start) else { return [] }
        var cells = (0 ..< 42).compactMap { cal.date(byAdding: .day, value: $0, to: gridStart) }
        while cells.count > 28, cells.suffix(7).allSatisfy({ !cal.isDate($0, equalTo: start, toGranularity: .month) }) {
            cells.removeLast(7)
        }
        return cells
    }

    private func weekDays(_ date: Date) -> [Date] {
        let day = cal.startOfDay(for: date)
        let lead = (cal.component(.weekday, from: day) - cal.firstWeekday + 7) % 7
        guard let start = cal.date(byAdding: .day, value: -lead, to: day) else { return [] }
        return (0 ..< 7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    private var weekdaySymbols: [String] {
        let symbols = cal.veryShortWeekdaySymbols
        let start = cal.firstWeekday - 1
        return (0 ..< 7).map { symbols[($0 + start) % 7] }
    }

    private func span(_ days: [Date]) -> String {
        guard let first = days.first, let last = days.last else { return "" }
        if cal.isDate(first, equalTo: last, toGranularity: .month) {
            return "\(first.formatted(.dateTime.month(.abbreviated).day())) – \(last.formatted(.dateTime.day()))"
        }
        return "\(first.formatted(.dateTime.month(.abbreviated).day())) – \(last.formatted(.dateTime.month(.abbreviated).day()))"
    }

    private func events(on day: Date) -> [CalendarItem] {
        items.filter { occurs($0, on: day) }.sorted { a, b in
            if a.allDay != b.allDay { return a.allDay }
            return a.start < b.start
        }
    }

    // An all-day event's end date is the morning it stops, so that day is not included.
    private func occurs(_ item: CalendarItem, on day: Date) -> Bool {
        let startOf = cal.startOfDay(for: day)
        guard let next = cal.date(byAdding: .day, value: 1, to: startOf) else { return false }
        if item.allDay {
            let key = ymd(startOf)
            let start = String(item.start.prefix(10))
            let end = String(item.end.prefix(10))
            if end <= start { return key == start }
            return key >= start && key < end
        }
        guard let start = Format.date(item.start) else { return false }
        let end = Format.date(item.end) ?? start
        return start < next && end > startOf
    }

    private func mark(_ item: CalendarItem) -> Color {
        switch item.kind {
        case "holiday", "prep": Theme.warm
        case "workout": Theme.good
        default: Color.white.opacity(0.45)
        }
    }

    private func ymd(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: date)
    }

    private func load() async {
        let days = windowDays
        guard let from = days.first, let to = days.last, let client = model.client else { return }
        generation += 1
        let gen = generation
        loading = true
        defer { if gen == generation { loading = false } }
        do {
            let next = try await client.calendar(from: from, to: to)
            if gen == generation { items = next; error = nil }
        } catch is CancellationError {
            return
        } catch {
            if gen == generation { self.error = error.localizedDescription; model.handle(error) }
        }
    }
}

// What opens when an event is tapped. A goal session can be marked done (also long after the fact), skipped, moved, undone and have its plan
// edited, with its title and times; any other event comes from Outlook and is shown as it is.
private struct CalendarItemSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let item: CalendarItem
    let changed: () async -> Void
    @State private var editing = false
    @State private var draft = ""
    @State private var title = ""
    @State private var start = Date()
    @State private var end = Date()
    @State private var busy = false
    @State private var error: String?

    private func run(_ id: String, _ body: [String: Any]) {
        Task {
            guard let client = model.client else { return }
            busy = true; defer { busy = false }
            do { try await client.sessionAction(id, body); await changed(); dismiss() }
            catch is CancellationError { return }
            catch { self.error = error.localizedDescription }
        }
    }

    private func iso(_ d: Date) -> String { ISO8601DateFormatter().string(from: d) }

    private func beginEditing(_ s: CalendarSession) {
        title = item.title
        start = Format.date(item.start) ?? Date()
        end = Format.date(item.end) ?? start.addingTimeInterval(3600)
        draft = s.note ?? ""
        editing = true
    }

    // Sends only what changed: the title and times in one call, the plan in another.
    private func save(_ id: String, _ s: CalendarSession) {
        Task {
            guard let client = model.client else { return }
            busy = true; defer { busy = false }
            let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let timesChanged = Format.date(item.start) != start || Format.date(item.end) != end
            do {
                if (!name.isEmpty && name != item.title) || timesChanged {
                    var body: [String: Any] = ["action": "edit"]
                    if !name.isEmpty && name != item.title { body["title"] = name }
                    if timesChanged { body["start"] = iso(start); body["end"] = iso(end) }
                    try await client.sessionAction(id, body)
                }
                if draft != (s.note ?? "") { try await client.sessionAction(id, ["action": "note", "note": draft]) }
                await changed(); dismiss()
            } catch is CancellationError { return }
            catch { self.error = error.localizedDescription }
        }
    }

    private func button(_ label: String, _ icon: String, tint: Color? = nil, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(label, systemImage: icon).font(.subheadline.weight(.medium)).padding(.horizontal, 12).frame(height: 38).chip(tint) }
            .buttonStyle(.plain).disabled(busy)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(item.title).font(.title3.weight(.semibold)).strikethrough(item.session?.status == "skipped")
                            Spacer(minLength: 0)
                            if let s = item.session {
                                HStack(spacing: 6) {
                                    if let goal = s.goal { Text(goal).foregroundStyle(Theme.muted) }
                                    Text(s.status.capitalized).foregroundStyle(sessionTint(s.status))
                                }
                                .font(.caption).lineLimit(1)
                            }
                        }
                        Text(Format.time(item) + (item.location.map { $0.isEmpty ? "" : " \u{00B7} \($0)" } ?? "")).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    if let s = item.session, let id = s.id {
                        SessionBody(blocks: s.noteBlocks, extra: s.notesBlocks, summary: s.actual?.summary, url: s.actual?.url)
                        if editing {
                            VStack(alignment: .leading, spacing: 10) {
                                TextField("Title", text: $title).padding(10).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
                                DatePicker("Starts", selection: $start).datePickerStyle(.compact)
                                DatePicker("Ends", selection: $end).datePickerStyle(.compact)
                                Text("Plan").font(.caption).foregroundStyle(Theme.muted)
                                TextEditor(text: $draft).frame(minHeight: 140).scrollContentBackground(.hidden).padding(8).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
                                Text("One step per line. Start a line with - for a bullet and end a heading with a colon.").font(.caption2).foregroundStyle(Theme.muted)
                                HStack(spacing: 8) {
                                    button("Save", "checkmark", tint: Theme.good.opacity(0.4)) { save(id, s) }
                                    button("Cancel", "xmark") { editing = false }
                                }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    if s.status != "done" { button("Mark done", "checkmark", tint: Theme.good.opacity(0.4)) { run(id, ["action": "done"]) } }
                                    if s.status == "planned" {
                                        button("Move", "arrow.right") { run(id, ["action": "move"]) }
                                        button("Skip", "xmark") { run(id, ["action": "skip"]) }
                                    } else {
                                        button("Undo", "arrow.uturn.backward") { run(id, ["action": "reopen"]) }
                                    }
                                }
                                button("Edit", "pencil") { beginEditing(s) }
                            }
                        }
                    } else {
                        Text("This event comes from your Outlook calendar, so it is changed there.").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    ErrorBanner(text: error)
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Ambient())
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Close") { dismiss() } } }
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
