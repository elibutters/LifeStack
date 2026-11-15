import SwiftUI

// What the goals endpoint returns (see lib/goals.ts): every goal with its progress.
struct GoalSessionDTO: Decodable, Identifiable, Equatable {
    let id: String
    let goalId: String
    let title: String
    let start: String
    let end: String
    let minutes: Int
    let status: String   // planned | done | skipped | replaced
    let note: String?    // the plan as written, so the same editor the calendar uses can change it
    let minutesSpent: Int?
    let rating: Int?
    let logNote: String?
    let onCalendar: Bool
    let noteBlocks: [NoteBlock]?
    let notesBlocks: [NoteBlock]?
    let actual: Actual?
    struct Actual: Decodable, Equatable { let summary: String; let url: String }
}

struct GoalDetail: Decodable, Identifiable, Equatable {
    struct Info: Decodable, Equatable, Identifiable { let id: String; let title: String; let thesis: String; let kind: String; let mode: String; let status: String; let targetDay: String?; let doneNote: String? }
    struct Progress: Decodable, Equatable { let planned: Int; let done: Int; let skipped: Int; let minutesDone: Int }
    var id: String { goal.id }
    let goal: Info
    let notebook: String?
    let progress: Progress
    let next: GoalSessionDTO?
    let sessions: [GoalSessionDTO]?
}

// The goals calls live here, not in APIClient.swift, because that file is also built into the widgets, which do not have these types.
extension APIClient {
    func goals() async throws -> [GoalDetail] {
        struct R: Decodable { let goals: [GoalDetail] }
        return (try await get("api/v1/goals") as R).goals
    }
    // Up to three different days a session could go, each free of meetings and of other sessions. It changes nothing.
    func sessionSuggestions(_ id: String) async throws -> [(start: String, end: String)] {
        struct R: Decodable { struct Slot: Decodable { let start: String; let end: String }; let slots: [Slot] }
        let data = try await request("api/v1/goals/sessions/\(id)", method: "POST", body: try JSONSerialization.data(withJSONObject: ["action": "suggest", "count": 3]))
        return try JSONDecoder().decode(R.self, from: data).slots.map { ($0.start, $0.end) }
    }
    // action is done, skip or move; a move may carry the ISO start to move to, otherwise the server picks the next free slot.
    func sessionAction(_ id: String, _ body: [String: Any]) async throws {
        _ = try await request("api/v1/goals/sessions/\(id)", method: "POST", body: try JSONSerialization.data(withJSONObject: body))
    }
    // title, thesis, kind, targetDay (or null), mode and status. Anything else is refused.
    // PATCH is the app route. Until that route is on the server the phone is talking to, the same change goes through update_goal, which is already there.
    func updateGoal(_ id: String, _ fields: [String: Any]) async throws {
        let patch = try JSONSerialization.data(withJSONObject: fields)
        do {
            _ = try await request("api/v1/goals/\(id)", method: "PATCH", body: patch)
            return
        } catch APIError.server {}
        var args = fields
        args["id"] = id
        let rpc: [String: Any] = ["jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": ["name": "update_goal", "arguments": args]]
        let data = try await request("api/v1/mcp", method: "POST", body: try JSONSerialization.data(withJSONObject: rpc), accept: "application/json, text/event-stream")
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw APIError.server }
        let result = obj["result"] as? [String: Any]
        if obj["error"] != nil || result?["isError"] as? Bool == true { throw APIError.rejected("That did not save.") }
    }
}

// The goals: what is on, what slipped, and how each one is going. Done, Move and Skip are on the goal itself.
struct GoalsView: View {
    @Environment(AppModel.self) private var model
    @State private var goals = Loader<[GoalDetail]>()
    @State private var busy: String?
    @State private var note: String?
    @State private var moving: GoalSessionDTO?   // the session whose Move sheet is open
    @State private var logging: GoalSessionDTO?  // the session being marked done, with a comment
    @State private var finishing: GoalDetail.Info?
    @State private var opened: CalendarItem?     // a session opened in the same sheet the calendar uses
    @State private var editing: GoalDetail.Info?
    private let order = ["active": 0, "draft": 1, "done": 2, "archived": 3]

    private struct GoalRef: Hashable, Identifiable { let id: String }
    @State private var open: GoalRef?

    var body: some View {
        NavigationStack {
            Screen(title: "Goals", refresh: { await load() }) {
                ErrorBanner(text: note ?? goals.error)
                if let list = goals.value {
                    if list.isEmpty {
                        Card(title: "Your goals") { Empty(text: "No goals yet. Tell your assistant what you are working toward and when, and it fits sessions into your real free time. Try: set up interview prep, interview on Nov 9, an hour every other day.") }
                    } else {
                        // Live goals, then drafts, then finished ones. Each group has its own heading.
                        let sorted = list.sorted { (order[$0.goal.status] ?? 9) < (order[$1.goal.status] ?? 9) }
                        let live = sorted.filter { $0.goal.status == "active" }
                        let drafts = sorted.filter { $0.goal.status == "draft" }
                        let done = sorted.filter { $0.goal.status == "done" }
                        let archived = sorted.filter { $0.goal.status == "archived" }
                        if !live.isEmpty {
                            sectionHead("Live")
                            ForEach(live) { goalRow($0) }
                        }
                        if !drafts.isEmpty {
                            sectionHead("Draft")
                            ForEach(drafts) { goalRow($0) }
                        }
                        if !done.isEmpty {
                            sectionHead("Done")
                            ForEach(done) { goalRow($0) }
                        }
                        if !archived.isEmpty {
                            sectionHead("Archived")
                            ForEach(archived) { goalRow($0) }
                        }
                    }
                } else if goals.loading { ProgressView().padding(.top, 40) }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $open) { ref in
                Group {
                    if let g = goals.value?.first(where: { $0.id == ref.id }) {
                        Screen(title: "Goal", refresh: { await load() }, trailing: {
                            Button { editing = g.goal } label: { Image(systemName: "pencil").font(.title3).foregroundStyle(Theme.sky).frame(width: 44, height: 36) }
                                .buttonStyle(.plain).accessibilityLabel("Edit goal").accessibilityIdentifier("edit-goal")
                        }) {
                            ErrorBanner(text: note ?? goals.error)
                            goalCard(g)
                        }
                    } else {
                        Screen(title: "Goal") { Empty(text: "That goal is no longer here.") }
                    }
                }
                .toolbar(.hidden, for: .navigationBar)
                .navigationBarBackButtonHidden(true)
                .environment(\.screenBack, { open = nil })
            }
        }
        .task { await load() }
        .sheet(item: $moving) { s in MoveSheet(session: s) { await load() } }
        .sheet(item: $logging) { s in LogDoneSheet(session: s) { await load() } }
        .sheet(item: $finishing) { info in FinishGoalSheet(goal: info) { await load() } }
        .sheet(item: $opened) { item in CalendarItemSheet(item: item) { await load() } }
        .sheet(item: $editing) { info in GoalEditor(goal: info) { await load() } }
    }

    private func load() async { await goals.load(model) { try await $0.goals() } }

    private func start(_ info: GoalDetail.Info) {
        Task {
            guard let client = model.client else { return }
            busy = info.id; defer { busy = nil }
            do { try await client.updateGoal(info.id, ["status": "active"]); note = nil }
            catch is CancellationError { return }
            catch { note = error.localizedDescription }
            await load()
        }
    }

    private func act(_ id: String, _ body: [String: Any]) {
        Task {
            guard let client = model.client else { return }
            busy = id; defer { busy = nil }
            do { try await client.sessionAction(id, body); note = nil }
            catch is CancellationError { return }
            catch { note = error.localizedDescription }
            await load()
        }
    }

    private func when(_ iso: String) -> String { Format.date(iso)?.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()) ?? iso }

    // Done stays green: that count is what already happened. The word beside the title carries the pace color.
    // Anything already due that was not done is skipped. There is no third state.
    private func paceLine(_ pace: GoalPace, extra: String?) -> Text {
        var line = AttributedString("\(pace.done) done")
        line.foregroundColor = pace.done > 0 ? Theme.good : Theme.muted
        var skipped = AttributedString(" · \(pace.skipped) skipped")
        skipped.foregroundColor = pace.skipped > 0 ? Theme.bad : Theme.muted
        line.append(skipped)
        if let extra {
            var more = AttributedString(" · \(extra)")
            more.foregroundColor = Theme.muted
            line.append(more)
        }
        return Text(line)
    }
    private func hours(_ m: Int) -> String { m >= 60 ? "\(m / 60) h" + (m % 60 > 0 ? " \(m % 60) min" : "") : "\(m) min" }

    private func sectionHead(_ title: String) -> some View {
        Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8).padding(.leading, 2)
            .accessibilityAddTraits(.isHeader)
    }

    // One short row per goal: name, how on track it is, and done against skipped. It opens the full goal.
    // A finished goal drops the bar. The counts stay, and the card itself says it is done.
    private func goalRow(_ g: GoalDetail) -> some View {
        let pace = GoalPace(g)
        let finished = g.goal.status == "done"
        return Button { open = GoalRef(id: g.id) } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if finished { Image(systemName: "checkmark.circle.fill").font(.body).foregroundStyle(Theme.good) }
                        Text(g.goal.title).font(.headline).lineLimit(1)
                        Spacer(minLength: 0)
                        if finished {
                            Text("DONE").font(.caption2.weight(.bold)).tracking(0.6)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .foregroundStyle(Theme.good).background(Theme.good.opacity(0.16), in: Capsule())
                        } else {
                            Text(pace.word).font(.caption2.weight(.semibold)).foregroundStyle(pace.tint)
                        }
                    }
                    if !finished { PaceBar(pace: pace) }
                    paceLine(pace, extra: finished ? nil : g.next.map { "next \(when($0.start))" }).font(.caption).lineLimit(1).monospacedDigit()
                }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
            .overlay { if finished { RoundedRectangle(cornerRadius: Theme.r).strokeBorder(Theme.good.opacity(0.55), lineWidth: 1) } }
            .accessibilityElement(children: .combine)
        }
        .buttonStyle(.plain)
    }

    private func goalCard(_ g: GoalDetail) -> some View {
        let pace = GoalPace(g)
        let finished = g.goal.status == "done"
        return Card(title: g.goal.title, trailing: finished ? nil : pace.word, trailingTint: pace.tint) {
            if finished {
                Label("Done", systemImage: "checkmark.circle.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.good)
            }
            Button { editing = g.goal } label: {
                Text(g.goal.thesis.isEmpty ? "Add a description" : g.goal.thesis).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(4).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(g.goal.thesis.isEmpty ? "Add a description" : "Edit description")
            if !finished { PaceBar(pace: pace) }
            paceLine(pace, extra: g.progress.minutesDone > 0 ? "\(hours(g.progress.minutesDone)) so far" : nil).font(.subheadline).monospacedDigit()
            Text([goalLabel(goalKinds, g.goal.kind), g.goal.targetDay.map { "by \($0)" }, "when a session slips: \(goalLabel(goalModes, g.goal.mode))", g.next.map { "next: \(when($0.start))" }].compactMap { $0 }.joined(separator: " \u{00B7} ")).font(.caption).foregroundStyle(Theme.muted)
            if g.goal.status == "done", let said = g.goal.doneNote, !said.isEmpty {
                Text(said).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
            }
            sessionList(g)
            HStack(spacing: 8) {
                if let url = g.notebook.flatMap(URL.init(string:)) { Link(destination: url) { Label("Open notebook", systemImage: "book").font(.subheadline.weight(.medium)).padding(.horizontal, 12).frame(height: 36).chip() } }
                if g.goal.status == "draft" {
                    Button { start(g.goal) } label: { Label("Start", systemImage: "play.fill").font(.subheadline.weight(.medium)).padding(.horizontal, 12).frame(height: 36).chip(Theme.good.opacity(0.35)) }
                        .buttonStyle(.plain).disabled(busy == g.goal.id)
                }
                if g.goal.status == "active" || g.goal.status == "draft" {
                    Button { finishing = g.goal } label: { Label("Mark done", systemImage: "checkmark").font(.subheadline.weight(.medium)).padding(.horizontal, 12).frame(height: 36).chip() }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    // A planned session whose time has passed was not done, so it counts as skipped.
    private func lapsed(_ s: GoalSessionDTO) -> Bool { s.status == "planned" && (Format.date(s.end).map { $0 < Date() } ?? false) }

    // Every session of the goal, in order. Tapping one opens the same sheet as tapping it on the calendar.
    @ViewBuilder private func sessionList(_ g: GoalDetail) -> some View {
        let all = g.sessions ?? []
        let skipped = all.filter { $0.status == "skipped" || lapsed($0) }
        let live = all.filter { $0.status != "skipped" && !lapsed($0) }
        if !live.isEmpty {
            DisclosureGroup("Sessions \u{00B7} \(live.filter { $0.status == "done" }.count) / \(live.count) done") { VStack(alignment: .leading, spacing: 10) { ForEach(live) { sessionRow($0, goal: g.goal.title) } }.padding(.top, 6) }
                .font(.subheadline.weight(.medium)).tint(Theme.muted)
        }
        if !skipped.isEmpty {
            DisclosureGroup("Skipped (\(skipped.count))") { VStack(alignment: .leading, spacing: 10) { ForEach(skipped) { sessionRow($0, goal: g.goal.title) } }.padding(.top, 6) }
                .font(.subheadline).foregroundStyle(Theme.muted).tint(Theme.muted)
        }
    }

    // The calendar sheet is built for a calendar event. A goal session carries the same facts, so it can open that sheet directly.
    private func calendarItem(_ s: GoalSessionDTO, goal: String) -> CalendarItem {
        let id = s.id.utf8.reduce(Int(0)) { ($0 &* 31) &+ Int($1) }
        return CalendarItem(id: id, title: s.title, start: s.start, end: s.end, allDay: false, kind: "session", location: nil, session: CalendarSession(
            id: s.id, note: s.note, minutes: s.minutes, minutesSpent: s.minutesSpent, rating: s.rating, logNote: s.logNote, status: s.status, goal: goal,
            noteBlocks: s.noteBlocks, notesBlocks: s.notesBlocks, actual: s.actual.map { CalendarSession.Actual(summary: $0.summary, url: $0.url) }
        ))
    }

    private func sessionRow(_ s: GoalSessionDTO, goal: String) -> some View {
        let skipped = s.status == "skipped" || lapsed(s)
        return HStack(alignment: .top, spacing: 8) {
            Button { opened = calendarItem(s, goal: goal) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.title).font(.subheadline.weight(.medium)).strikethrough(skipped || s.status == "replaced").foregroundStyle(skipped || s.status == "replaced" ? Theme.muted : .white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(when(s.start)) \u{00B7} \(s.minutes) min").font(.caption).foregroundStyle(Theme.muted)
                    if let said = s.logNote, !said.isEmpty {
                        Text(said).font(.caption).foregroundStyle(Theme.muted).lineLimit(3)
                    }
                    if let actual = s.actual?.summary {
                        Text(actual.replacingOccurrences(of: "Actual: ", with: "").replacingOccurrences(of: " (Strava)", with: "")).font(.caption).foregroundStyle(Theme.muted)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens this session")
            if s.status == "planned" && !lapsed(s) {
                Menu {
                    Button("Done", systemImage: "checkmark") { logging = s }
                    Button("Move", systemImage: "arrow.right") { moving = s }
                    Button("Skip", systemImage: "xmark") { act(s.id, ["action": "skip"]) }
                } label: { Image(systemName: "ellipsis.circle").foregroundStyle(Theme.muted).frame(width: 32, height: 32) }
            } else if s.status == "planned" {
                Button { logging = s } label: { Text("Done").font(.caption.weight(.semibold)).foregroundStyle(Theme.good) }.buttonStyle(.plain)
            } else {
                Text(skipped ? "Skipped" : s.status.capitalized).font(.caption2).foregroundStyle(sessionTint(skipped ? "skipped" : s.status))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
        .opacity(busy == s.id ? 0.5 : 1)
    }
}

// How a goal is going. Follow-through is done against everything already due. A session that was not done is skipped,
// including one still marked planned after its time has passed. The schedule compares how much of the plan is finished
// with how much of the time to the target day has passed. The color is the worse of the two.
private struct GoalPace {
    let done: Int
    let skipped: Int
    let upcoming: Int
    let tint: Color
    let word: String

    var total: Int { done + skipped + upcoming }

    init(_ g: GoalDetail, now: Date = Date()) {
        done = g.progress.done
        let sessions = g.sessions ?? []
        let lapsed = sessions.filter { $0.status == "planned" && (Format.date($0.end).map { $0 < now } ?? false) }.count
        skipped = g.progress.skipped + lapsed
        upcoming = max(g.progress.planned - lapsed, 0)
        if g.goal.status == "archived" {
            tint = Theme.muted
            word = "Archived"
            return
        }
        if g.goal.status == "done" {
            tint = Theme.good
            word = "Done"
            return
        }
        if done + skipped + g.progress.planned == 0 {
            tint = Theme.muted
            word = g.goal.status == "draft" ? "Draft" : "No sessions"
            return
        }
        let settled = done + skipped
        let follow = settled == 0 ? 1.0 : Double(done) / Double(settled)
        let health = min(follow, Self.schedule(g, done: done, planned: g.progress.planned, now: now) ?? 1)
        switch health {
        case 0.85...: tint = Theme.good; word = "On track"
        case 0.65..<0.85: tint = Theme.mood(4); word = "Steady"
        case 0.45..<0.65: tint = Theme.warm; word = "Slipping"
        case 0.25..<0.45: tint = Theme.mood(2); word = "Behind"
        default: tint = Theme.bad; word = "Off track"
        }
    }

    // 1 when finished sessions are keeping up with the time already gone. Nil when there is no target day to measure against.
    private static func schedule(_ g: GoalDetail, done: Int, planned: Int, now: Date) -> Double? {
        guard let target = g.goal.targetDay.flatMap(Format.dayDate) else { return nil }
        let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: target)) ?? target
        guard let first = (g.sessions ?? []).compactMap({ Format.date($0.start) }).min(), end > first else { return nil }
        let elapsed = min(max(now.timeIntervalSince(first) / end.timeIntervalSince(first), 0), 1)
        let plan = done + planned
        let finished = plan == 0 ? 0.0 : Double(done) / Double(plan)
        return min(max(finished - elapsed + 1, 0), 1)
    }
}

// Done and skipped as shares of the whole plan. Finished work is green whatever the pace word says.
private struct PaceBar: View {
    let pace: GoalPace

    var body: some View {
        GeometryReader { geo in
            let total = CGFloat(max(pace.total, 1))
            HStack(spacing: 2) {
                chunk(pace.done, total, geo.size.width, Theme.good)
                chunk(pace.skipped, total, geo.size.width, Theme.bad)
                Spacer(minLength: 0)
            }
        }
        .frame(height: 8)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 2))
        .clipShape(RoundedRectangle(cornerRadius: 2))
        .accessibilityLabel("\(pace.done) done, \(pace.skipped) skipped, \(pace.word)")
    }

    @ViewBuilder private func chunk(_ count: Int, _ total: CGFloat, _ width: CGFloat, _ color: Color) -> some View {
        if count > 0 {
            color.frame(width: max(width * CGFloat(count) / total, 4))
        }
    }
}

private let goalKinds = [("prep", "Prep"), ("progress", "Progress"), ("train", "Training"), ("custom", "Custom")]
private let goalModes = [("ask", "Ask me"), ("slide", "Slide"), ("auto", "Automatic")]
private let goalStatuses = [("draft", "Draft"), ("active", "Active"), ("done", "Done"), ("archived", "Archived")]

private func goalLabel(_ options: [(String, String)], _ value: String) -> String {
    options.first { $0.0 == value }?.1 ?? value.capitalized
}

private func knownChoice(_ value: String, _ options: [(String, String)], fallback: String) -> String {
    options.contains { $0.0 == value } ? value : fallback
}

// Rename a goal and change its description, kind, target date, what happens when a session slips, and its status.
private struct GoalEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let goal: GoalDetail.Info
    let done: () async -> Void

    @State private var title: String
    @State private var thesis: String
    @State private var kind: String
    @State private var mode: String
    @State private var status: String
    @State private var hasTarget: Bool
    @State private var target: Date
    @State private var saving = false
    @State private var error: String?

    init(goal: GoalDetail.Info, done: @escaping () async -> Void) {
        self.goal = goal
        self.done = done
        _title = State(initialValue: goal.title)
        _thesis = State(initialValue: goal.thesis)
        _kind = State(initialValue: knownChoice(goal.kind, goalKinds, fallback: "custom"))
        _mode = State(initialValue: knownChoice(goal.mode, goalModes, fallback: "ask"))
        _status = State(initialValue: knownChoice(goal.status, goalStatuses, fallback: "active"))
        let day = goal.targetDay.flatMap(Format.dayDate)
        _hasTarget = State(initialValue: day != nil)
        _target = State(initialValue: day ?? .now)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ErrorBanner(text: error)
                    textCard("Name") {
                        TextField("Name", text: $title).accessibilityIdentifier("goal-name")
                    }
                    textCard("Description", hint: "Why it matters, and what done looks like.") {
                        TextField("Description", text: $thesis, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("goal-description")
                    }
                    choiceGrid("Kind", goalKinds, $kind)
                    Card(title: "Target date") {
                        Toggle("Aim for a date", isOn: $hasTarget).tint(Theme.accent)
                        if hasTarget { DatePicker("By", selection: $target, displayedComponents: .date) }
                        Text("Sessions are not placed after this day.").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Card(title: "When a session slips") {
                        VStack(spacing: 8) {
                            ForEach(goalModes, id: \.0) { pair in
                                choice(pair.1, on: mode == pair.0) { mode = pair.0 }
                            }
                        }
                        Text("Ask me never moves a slipped session on its own.").font(.caption).foregroundStyle(Theme.muted)
                    }
                    choiceGrid("Status", goalStatuses, $status)
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Ambient())
            .navigationTitle("Edit goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func textCard<F: View>(_ title: String, hint: String? = nil, @ViewBuilder field: () -> F) -> some View {
        Card(title: title) {
            field()
                .font(.body)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
            if let hint { Text(hint).font(.caption).foregroundStyle(Theme.muted) }
        }
    }

    private func choiceGrid(_ title: String, _ options: [(String, String)], _ selection: Binding<String>) -> some View {
        Card(title: title) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(options, id: \.0) { pair in
                    choice(pair.1, on: selection.wrappedValue == pair.0) { selection.wrappedValue = pair.0 }
                }
            }
        }
    }

    private func choice(_ label: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.subheadline.weight(.medium)).foregroundStyle(on ? .white : Theme.muted)
                .frame(maxWidth: .infinity).frame(height: 36).chip(on ? Theme.accent.opacity(0.35) : nil)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func ymd(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func save() async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let about = thesis.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { error = "Add a name."; return }
        if name.count > 120 || about.count > 2000 { error = "That is too long."; return }
        guard let client = model.client else { return }
        saving = true
        defer { saving = false }
        var body: [String: Any] = ["title": name, "thesis": about, "kind": kind, "mode": mode, "status": status]
        body["targetDay"] = hasTarget ? ymd(target) : NSNull()
        do {
            try await client.updateGoal(goal.id, body)
            error = nil
            await done()
            dismiss()
        } catch is CancellationError {}
        catch { self.error = error.localizedDescription }
    }
}

// Mark one session done and keep a comment on it. Nothing is saved until Mark done.
private struct LogDoneSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let session: GoalSessionDTO
    let done: () async -> Void

    @State private var note = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ErrorBanner(text: error)
                    Text(session.title).font(.title2.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                    Text("Add a comment if you want. It stays on this session.").font(.subheadline).foregroundStyle(Theme.muted)
                    TextField("Comment", text: $note, axis: .vertical).lineLimit(2...5).padding(10)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 24)
            }
            .background(Ambient())
            .safeAreaInset(edge: .bottom) {
                Button { Task { await save() } } label: {
                    Text(saving ? "Saving" : "Mark done").font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                        .foregroundStyle(Color.black).background(Theme.good, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain).disabled(saving).opacity(saving ? 0.5 : 1)
                .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8).background(.bar)
            }
            .navigationTitle("Mark done")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func save() async {
        let said = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if said.count > 1000 { error = "That comment is too long."; return }
        guard let client = model.client else { return }
        saving = true
        defer { saving = false }
        var body: [String: Any] = ["action": "done"]
        if !said.isEmpty { body["note"] = said }
        do {
            try await client.sessionAction(session.id, body)
            error = nil
            await done()
            dismiss()
        } catch is CancellationError {}
        catch { self.error = error.localizedDescription }
    }
}

// Mark the goal itself done. Its sessions stay as they are, so one of them can be marked done on its own.
private struct FinishGoalSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let goal: GoalDetail.Info
    let done: () async -> Void

    @State private var note: String
    @State private var saving = false
    @State private var error: String?

    init(goal: GoalDetail.Info, done: @escaping () async -> Void) {
        self.goal = goal
        self.done = done
        _note = State(initialValue: goal.doneNote ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ErrorBanner(text: error)
                    Text(goal.title).font(.title2.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                    Text("Add a comment if you want. It stays on the goal.").font(.subheadline).foregroundStyle(Theme.muted)
                    TextField("Comment", text: $note, axis: .vertical).lineLimit(2...5).padding(10)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
                }
                .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 24)
            }
            .background(Ambient())
            .safeAreaInset(edge: .bottom) {
                Button { Task { await save() } } label: {
                    Text(saving ? "Saving" : "Mark goal done").font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                        .foregroundStyle(Color.black).background(Theme.good, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain).disabled(saving).opacity(saving ? 0.5 : 1)
                .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8).background(.bar)
            }
            .navigationTitle("Mark done")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func save() async {
        let said = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if said.count > 1000 { error = "That comment is too long."; return }
        guard let client = model.client else { return }
        saving = true
        defer { saving = false }
        var body: [String: Any] = ["status": "done"]
        if !said.isEmpty { body["doneNote"] = said }
        do {
            try await client.updateGoal(goal.id, body)
            error = nil
            await done()
            dismiss()
        } catch is CancellationError {}
        catch { self.error = error.localizedDescription }
    }
}
