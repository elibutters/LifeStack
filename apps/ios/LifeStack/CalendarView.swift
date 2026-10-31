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

// What opens when an event is tapped. A goal session shows its status, plan, actual run and notes, can be marked done (also long after the
// fact, with how long it took and how it went), skipped, undone, rescheduled and edited. Any other event comes from Outlook and is shown
// as it is.
struct CalendarItemSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let item: CalendarItem
    let changed: () async -> Void

    @State private var editing = false
    @State private var title = ""
    @State private var start = Date()
    @State private var end = Date()
    @State private var draft = ""
    @State private var minutes = 0
    @State private var rating = 0
    @State private var logNote = ""
    @State private var busy = false
    @State private var error: String?
    @State private var suggestions: [Slot] = []
    @State private var loadingSuggestions = false

    private struct Slot: Hashable { let start: Date; let end: Date }

    private var startDate: Date? { Format.date(item.start) }
    private var endDate: Date? { Format.date(item.end) }
    private func iso(_ d: Date) -> String { ISO8601DateFormatter().string(from: d) }
    private func missed(_ s: CalendarSession) -> Bool { s.status == "planned" && (endDate.map { $0 < Date() } ?? false) }
    private func length(_ s: CalendarSession?) -> Int {
        if let m = s?.minutes { return m }
        guard let a = startDate, let b = endDate else { return 0 }
        return max(1, Int(b.timeIntervalSince(a) / 60))
    }

    // ---- actions
    private func run(_ id: String, _ steps: [[String: Any]]) {
        Task {
            guard let client = model.client else { error = "Not signed in."; return }
            busy = true; defer { busy = false }
            do {
                for body in steps { try await client.sessionAction(id, body) }
                await changed(); dismiss()
            } catch is CancellationError { return }
            catch { self.error = error.localizedDescription }
        }
    }

    // The log (time, rating, note) goes along when it was filled in, or when it is being saved on purpose.
    private func logged(_ s: CalendarSession) -> Bool { rating > 0 || !logNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || minutes != (s.minutesSpent ?? length(s)) }

    private func doneBody(_ s: CalendarSession, withLog: Bool) -> [String: Any] {
        var b: [String: Any] = ["action": "done"]
        if withLog || logged(s) {
            b["minutes"] = max(1, minutes)
            if rating > 0 { b["rating"] = rating }
            let n = logNote.trimmingCharacters(in: .whitespacesAndNewlines)
            if !n.isEmpty { b["note"] = n }
        }
        return b
    }

    private func beginEditing(_ s: CalendarSession) {
        title = item.title
        start = startDate ?? Date()
        end = endDate ?? start.addingTimeInterval(3600)
        draft = s.note ?? ""
        editing = true
        if let id = s.id, s.status != "done" { loadSuggestions(id) }
    }

    private func loadSuggestions(_ id: String) {
        Task {
            guard let client = model.client else { return }
            loadingSuggestions = true; defer { loadingSuggestions = false }
            let raw = (try? await client.sessionSuggestions(id)) ?? []
            suggestions = raw.compactMap { r in
                guard let a = Format.date(r.start), let b = Format.date(r.end) else { return nil }
                return Slot(start: a, end: b)
            }
        }
    }

    private func dayName(_ d: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInTomorrow(d) { return "Tomorrow" }
        return d.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    private func saveEdits(_ id: String, _ s: CalendarSession) {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var steps: [[String: Any]] = []
        let nameChanged = !name.isEmpty && name != item.title
        let timesChanged = startDate != start || endDate != end
        if nameChanged || timesChanged {
            var body: [String: Any] = ["action": "edit"]
            if nameChanged { body["title"] = name }
            if timesChanged { body["start"] = iso(start); body["end"] = iso(end) }
            steps.append(body)
        }
        if draft != (s.note ?? "") { steps.append(["action": "note", "note": draft]) }
        if steps.isEmpty { editing = false } else { run(id, steps) }
    }

    // ---- pieces
    private func pill(_ text: String, _ tint: Color) -> some View {
        Text(text).font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(tint).background(tint.opacity(0.16), in: Capsule())
    }

    private func card<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted)
            content()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).panel()
    }

    private func blocks(_ list: [NoteBlock]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(list.enumerated()), id: \.offset) { i, b in
                switch b.kind {
                case "heading": Text(b.text).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted).padding(.top, i == 0 ? 0 : 6)
                case "bullet":
                    HStack(alignment: .firstTextBaseline, spacing: 8) { Text("\u{2022}").foregroundStyle(Theme.muted); Text(b.text) }.font(.body)
                default: Text(b.text).font(.body)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func bigButton(_ label: String, _ icon: String, primary: Bool = false, tint: Color = Theme.good, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: icon).font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                .foregroundStyle(primary ? Color.black : Color.white)
                .background(primary ? tint : Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain).disabled(busy).opacity(busy ? 0.5 : 1)
    }

    private var header: some View {
        let s = item.session
        return VStack(alignment: .leading, spacing: 10) {
            if let s {
                HStack(spacing: 8) {
                    if let goal = s.goal { Text(goal.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted).lineLimit(1) }
                    Spacer(minLength: 0)
                    if missed(s) { pill("Missed", Theme.warm) } else { pill(s.status.capitalized, sessionTint(s.status)) }
                }
            }
            Text(item.title).font(.title.weight(.bold)).strikethrough(s?.status == "skipped").fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 6) {
                Label(Format.dayHeading(item), systemImage: "calendar")
                if !item.allDay {
                    Label([Format.time(item), endDate.map { "\u{2013} " + $0.formatted(date: .omitted, time: .shortened) }, "\u{00B7} \(length(s)) min"].compactMap { $0 }.joined(separator: " "), systemImage: "clock")
                }
                if let place = item.location, !place.isEmpty { Label(place, systemImage: "mappin.and.ellipse") }
            }
            .font(.subheadline).foregroundStyle(Theme.muted).labelStyle(.titleAndIcon)
        }
    }

    // ---- a goal session
    @ViewBuilder private func sessionContent(_ id: String, _ s: CalendarSession) -> some View {
        if missed(s) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "questionmark.circle.fill").foregroundStyle(Theme.warm)
                Text("This was planned for earlier and is still open. Did you do it?").font(.subheadline)
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.warm.opacity(0.14), in: RoundedRectangle(cornerRadius: Theme.r, style: .continuous))
        }
        if let plan = s.noteBlocks, !plan.isEmpty { card("Plan") { blocks(plan) } }
        if let a = s.actual {
            card("Actual") {
                Text(a.summary.replacingOccurrences(of: "Actual: ", with: "").replacingOccurrences(of: " (Strava)", with: "")).font(.body)
                if let url = URL(string: a.url) { Link(destination: url) { Label("View on Strava", systemImage: "arrow.up.right.square").font(.subheadline.weight(.medium)) }.foregroundStyle(Theme.accent) }
            }
        }
        // Only once it can have happened: a session still ahead has nothing to log. For a planned one the details go with the Mark done button
        // below; a session that is already done has its own button to update them.
        if s.status == "done" || (s.status == "planned" && missed(s)) {
            card(s.status == "done" ? "Your log" : "How it went (optional)") {
                Stepper(value: $minutes, in: 1...720, step: 5) { Text("\(minutes) min").font(.body.monospacedDigit()) }
                HStack(spacing: 6) {
                    ForEach(1...5, id: \.self) { n in
                        Button { rating = rating == n ? 0 : n } label: { Image(systemName: n <= rating ? "star.fill" : "star").font(.title3).foregroundStyle(n <= rating ? Theme.warm : Theme.muted) }.buttonStyle(.plain)
                    }
                    Spacer()
                    if rating > 0 { Text(["", "Rough", "Meh", "OK", "Good", "Great"][rating]).font(.subheadline).foregroundStyle(Theme.muted) }
                }
                TextField("Add a note about how it went", text: $logNote, axis: .vertical).lineLimit(1...4).padding(10)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
                if s.status == "done" { bigButton("Update log", "checkmark") { run(id, [doneBody(s, withLog: true)]) } }
            }
        }
        if let more = s.notesBlocks, !more.isEmpty { card("Notes") { blocks(more) } }
    }

    private func sessionBar(_ id: String, _ s: CalendarSession) -> some View {
        HStack(spacing: 10) {
            switch s.status {
            case "done": bigButton("Undo done", "arrow.uturn.backward") { run(id, [["action": "reopen"]]) }
            case "skipped":
                bigButton("Undo skip", "arrow.uturn.backward") { run(id, [["action": "reopen"]]) }
                bigButton("I did it", "checkmark", primary: true) { run(id, [doneBody(s, withLog: false)]) }
            default:
                bigButton("Skip", "xmark") { run(id, [["action": "skip"]]) }
                bigButton(missed(s) ? "I did it" : "Mark done", "checkmark", primary: true) { run(id, [doneBody(s, withLog: false)]) }
            }
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
        .background(.bar)
    }

    // ---- editing a goal session
    @ViewBuilder private func editForm(_ id: String, _ s: CalendarSession) -> some View {
        card("Title") {
            TextField("Title", text: $title).font(.body).padding(10).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
        }
        card("When") {
            DatePicker("Starts", selection: $start).datePickerStyle(.compact)
            DatePicker("Ends", selection: $end, in: start...).datePickerStyle(.compact)
            HStack(spacing: 8) {
                Button("30 min") { end = start.addingTimeInterval(1800) }.buttonStyle(.bordered)
                Button("1 hour") { end = start.addingTimeInterval(3600) }.buttonStyle(.bordered)
                Button("90 min") { end = start.addingTimeInterval(5400) }.buttonStyle(.bordered)
                Spacer(minLength: 0)
            }
            .font(.subheadline).tint(Theme.muted)
            if s.status != "done" {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Free times for it").font(.caption).foregroundStyle(Theme.muted)
                    if loadingSuggestions {
                        ProgressView().frame(maxWidth: .infinity, alignment: .leading)
                    } else if suggestions.isEmpty {
                        Text("No free time found in the next few weeks. Pick a time above.").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    ForEach(suggestions, id: \.self) { slot in
                        let chosen = start == slot.start && end == slot.end
                        Button { start = slot.start; end = slot.end } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(dayName(slot.start)).font(.subheadline.weight(.semibold))
                                    Text(slot.start.formatted(date: .omitted, time: .shortened) + " \u{2013} " + slot.end.formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                if chosen { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.good) }
                            }
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(chosen ? Theme.good.opacity(0.14) : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                    if !suggestions.isEmpty { Text("Tap one to fill in the times above, then Save changes. Nothing moves until you save.").font(.caption2).foregroundStyle(Theme.muted) }
                }
            }
        }
        card("Plan") {
            TextEditor(text: $draft).frame(minHeight: 170).scrollContentBackground(.hidden).padding(8)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
            HStack(spacing: 8) {
                Button { draft += (draft.isEmpty || draft.hasSuffix("\n") ? "" : "\n") + "- " } label: { Label("Bullet", systemImage: "list.bullet") }
                Button { draft += (draft.isEmpty || draft.hasSuffix("\n") ? "" : "\n") + "Section:\n- " } label: { Label("Section", systemImage: "textformat") }
                Spacer(minLength: 0)
            }
            .buttonStyle(.bordered).tint(Theme.muted).font(.subheadline)
            Text("One step per line. A line starting with - is a bullet, and a line ending in a colon is a heading. Write the words out in full.").font(.caption).foregroundStyle(Theme.muted)
        }
    }

    // ---- an event from Outlook
    private var outlookContent: some View {
        card("From Outlook") {
            Text("This event comes from your Outlook calendar, so it is changed there.").font(.subheadline).foregroundStyle(Theme.muted)
            if let place = item.location, !place.isEmpty,
               let url = URL(string: "http://maps.apple.com/?q=" + (place.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")) {
                Link(destination: url) { Label("Open in Maps", systemImage: "map").font(.subheadline.weight(.medium)) }.foregroundStyle(Theme.accent)
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    if let s = item.session, let id = s.id {
                        if editing { editForm(id, s) } else { sessionContent(id, s) }
                    } else {
                        outlookContent
                    }
                    ErrorBanner(text: error)
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 24)
            }
            .background(Ambient())
            .safeAreaInset(edge: .bottom) {
                if let s = item.session, let id = s.id {
                    if editing {
                        HStack(spacing: 10) {
                            bigButton("Cancel", "xmark") { editing = false }
                            bigButton("Save changes", "checkmark", primary: true) { saveEdits(id, s) }
                        }
                        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8).background(.bar)
                    } else { sessionBar(id, s) }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
                if let s = item.session, s.id != nil, !editing { ToolbarItem(placement: .topBarTrailing) { Button("Edit") { beginEditing(s) } } }
            }
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { if let s = item.session { minutes = s.minutesSpent ?? length(s); rating = s.rating ?? 0 } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}
