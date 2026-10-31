import SwiftUI

// What the goals endpoints return (see lib/goals.ts): tonight, and every goal with its progress.
struct GoalSessionDTO: Decodable, Identifiable, Equatable {
    let id: String
    let goalId: String
    let title: String
    let start: String
    let end: String
    let minutes: Int
    let status: String   // planned | done | skipped | replaced
    let onCalendar: Bool
    let noteBlocks: [NoteBlock]?
    let notesBlocks: [NoteBlock]?
    let actual: Actual?
    struct Actual: Decodable, Equatable { let summary: String; let url: String }
}

struct GoalsTonight: Decodable, Equatable {
    struct Slot: Decodable, Equatable { let start: String; let end: String }
    struct Decision: Decodable, Identifiable, Equatable {
        var id: String { session.id }
        let session: GoalSessionDTO
        let goal: String?
        let mode: String
        let suggestion: Slot?
    }
    let today: String
    let sessions: [GoalSessionDTO]
    let needsDecision: [Decision]
    let freeMinutesLeftToday: Int
}

struct GoalDetail: Decodable, Identifiable, Equatable {
    struct Info: Decodable, Equatable { let id: String; let title: String; let thesis: String; let kind: String; let mode: String; let status: String; let targetDay: String? }
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
    func goalsTonight() async throws -> GoalsTonight { try await get("api/v1/goals/tonight") }
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
}

// Tonight and the goals behind it: what is on, what slipped, and how each goal is going. Done, Move and Skip are one tap each.
struct GoalsView: View {
    @Environment(AppModel.self) private var model
    @State private var tonight = Loader<GoalsTonight>()
    @State private var goals = Loader<[GoalDetail]>()
    @State private var busy: String?
    @State private var note: String?
    @State private var moving: GoalSessionDTO?   // the session whose Move sheet is open
    private let order = ["active": 0, "draft": 1, "done": 2, "archived": 3]

    private struct GoalRef: Hashable, Identifiable { let id: String }
    @State private var open: GoalRef?

    var body: some View {
        NavigationStack {
            Screen(title: "Goals", refresh: { await load() }) {
                ErrorBanner(text: note ?? tonight.error ?? goals.error)
                if let t = tonight.value { tonightCard(t, names: Dictionary(uniqueKeysWithValues: (goals.value ?? []).map { ($0.goal.id, $0.goal.title) })) } else if tonight.loading { ProgressView().padding(.top, 40) }
                if let list = goals.value {
                    if list.isEmpty {
                        Card(title: "Your goals") { Empty(text: "No goals yet. Tell your assistant what you are working toward and when, and it fits sessions into your real free time. Try: set up interview prep, interview on Nov 9, an hour every other day.") }
                    } else {
                        // Active goals first, then drafts, then anything finished or put away. Each is one short row; tap for the whole goal.
                        ForEach(list.sorted { (order[$0.goal.status] ?? 9) < (order[$1.goal.status] ?? 9) }) { goalRow($0) }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $open) { ref in
                Group {
                    if let g = goals.value?.first(where: { $0.id == ref.id }) {
                        Screen(title: "Goal", refresh: { await load() }) {
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
    }

    private func load() async {
        async let a: Void = tonight.load(model) { try await $0.goalsTonight() }
        async let b: Void = goals.load(model) { try await $0.goals() }
        _ = await (a, b)
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
    private func span(_ s: GoalSessionDTO) -> String { "\(Format.clock(s.start)) to \(Format.clock(s.end))" }
    private func hours(_ m: Int) -> String { m >= 60 ? "\(m / 60) h" + (m % 60 > 0 ? " \(m % 60) min" : "") : "\(m) min" }

    private func chipButton(_ label: String, _ icon: String, tint: Color? = nil, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(label, systemImage: icon).font(.subheadline.weight(.medium)).padding(.horizontal, 12).frame(height: 36).chip(tint) }
            .buttonStyle(.plain)
    }

    private func tonightCard(_ t: GoalsTonight, names: [String: String]) -> some View {
        Card(title: "Tonight", trailing: "\(hours(t.freeMinutesLeftToday)) free left") {
            ForEach(t.needsDecision) { d in
                VStack(alignment: .leading, spacing: 8) {
                    Text(d.session.title).font(.headline)
                    Text("\(d.goal ?? "Goal") \u{00B7} was \(when(d.session.start)) and slipped").font(.caption).foregroundStyle(Theme.muted)
                    if d.suggestion == nil { Text("There is no free slot before the goal's last day.").font(.caption).foregroundStyle(Theme.muted) }
                    HStack(spacing: 8) {
                        if let s = d.suggestion { chipButton("Move to \(Format.clock(s.start))", "arrow.right", tint: Theme.blue.opacity(0.6)) { act(d.session.id, ["action": "move", "start": s.start]) } }
                        chipButton("I did it", "checkmark") { act(d.session.id, ["action": "done"]) }
                        chipButton("Skip", "xmark") { act(d.session.id, ["action": "skip"]) }
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
            }
            let rest = t.sessions.filter { s in !t.needsDecision.contains { $0.session.id == s.id } }
            ForEach(rest) { s in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(s.title).font(.headline).strikethrough(s.status == "done").foregroundStyle(s.status == "done" ? Theme.muted : .white)
                        Spacer(minLength: 0)
                        HStack(spacing: 6) {
                            if let goal = names[s.goalId] { Text(goal).foregroundStyle(Theme.muted) }
                            Text(s.status.capitalized).foregroundStyle(sessionTint(s.status))
                        }
                        .font(.caption2).lineLimit(1)
                    }
                    Text("\(span(s)) \u{00B7} \(s.minutes) min").font(.caption).foregroundStyle(Theme.muted)
                    SessionBody(blocks: s.noteBlocks, extra: s.notesBlocks, summary: s.actual?.summary, url: s.actual?.url)
                    if s.status == "planned" {
                        HStack(spacing: 8) {
                            chipButton("Done", "checkmark", tint: Theme.good.opacity(0.4)) { act(s.id, ["action": "done"]) }
                            chipButton("Move", "arrow.right") { moving = s }
                            chipButton("Skip", "xmark") { act(s.id, ["action": "skip"]) }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).opacity(busy == s.id ? 0.5 : 1)
            }
            if rest.isEmpty && t.needsDecision.isEmpty { Empty(text: "Nothing planned for today. Ask your assistant to plan something, or take the evening.") }
        }
    }

    // One short row per goal: name and status, a progress bar, and how far along it is. It opens the full goal.
    private func goalRow(_ g: GoalDetail) -> some View {
        let total = g.progress.done + g.progress.planned
        return Button { open = GoalRef(id: g.id) } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(g.goal.title).font(.headline).lineLimit(1)
                        Spacer(minLength: 0)
                        Text(g.goal.status.capitalized).font(.caption2).foregroundStyle(g.goal.status == "active" ? Theme.good : Theme.muted)
                    }
                    ProgressView(value: total == 0 ? 0 : Double(g.progress.done) / Double(total)).tint(Theme.sky)
                    Text("\(g.progress.done) / \(total) done" + (g.next.map { " \u{00B7} next \(when($0.start))" } ?? "")).font(.caption).foregroundStyle(Theme.muted).lineLimit(1).monospacedDigit()
                }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
        .buttonStyle(.plain)
    }

    private func goalCard(_ g: GoalDetail) -> some View {
        let total = g.progress.done + g.progress.planned   // skipped sessions are not part of the count
        return Card(title: g.goal.title, trailing: g.goal.status.capitalized, trailingTint: g.goal.status == "active" ? Theme.good : Theme.muted) {
            if !g.goal.thesis.isEmpty { Text(g.goal.thesis).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(4) }
            ProgressView(value: total == 0 ? 0 : Double(g.progress.done) / Double(total)).tint(Theme.sky)
            Text("\(g.progress.done) of \(total) sessions done" + (g.progress.skipped > 0 ? ", \(g.progress.skipped) skipped" : "") + (g.progress.minutesDone > 0 ? " \u{00B7} \(hours(g.progress.minutesDone)) so far" : "")).font(.subheadline).monospacedDigit()
            Text([g.goal.kind, g.goal.targetDay.map { "by \($0)" }, "when a session slips: \(g.goal.mode)", g.next.map { "next: \(when($0.start))" }].compactMap { $0 }.joined(separator: " \u{00B7} ")).font(.caption).foregroundStyle(Theme.muted)
            sessionList(g)
            if let url = g.notebook.flatMap(URL.init(string:)) { Link(destination: url) { Label("Open notebook", systemImage: "book").font(.subheadline.weight(.medium)).padding(.horizontal, 12).frame(height: 36).chip() } }
        }
    }

    // Every session of the goal, in order: status top right (a menu while it is still planned), the time, and the note and run on one line.
    @ViewBuilder private func sessionList(_ g: GoalDetail) -> some View {
        let all = g.sessions ?? []
        let live = all.filter { $0.status != "skipped" }
        let skipped = all.filter { $0.status == "skipped" }
        if !live.isEmpty {
            DisclosureGroup("Sessions \u{00B7} \(live.filter { $0.status == "done" }.count) / \(live.count) done") { VStack(alignment: .leading, spacing: 10) { ForEach(live) { sessionRow($0) } }.padding(.top, 6) }
                .font(.subheadline.weight(.medium)).tint(Theme.muted)
        }
        if !skipped.isEmpty {
            DisclosureGroup("Skipped (\(skipped.count))") { VStack(alignment: .leading, spacing: 10) { ForEach(skipped) { sessionRow($0) } }.padding(.top, 6) }
                .font(.subheadline).foregroundStyle(Theme.muted).tint(Theme.muted)
        }
    }

    private func sessionRow(_ s: GoalSessionDTO) -> some View {
        let missed = s.status == "planned" && (Format.date(s.end).map { $0 < Date() } ?? false)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(s.title).font(.subheadline.weight(.medium)).strikethrough(s.status == "skipped" || s.status == "replaced").foregroundStyle(s.status == "skipped" || s.status == "replaced" ? Theme.muted : .white)
                Spacer(minLength: 0)
                if s.status == "planned" && !missed {
                    Menu {
                        Button("Done", systemImage: "checkmark") { act(s.id, ["action": "done"]) }
                        Button("Move", systemImage: "arrow.right") { moving = s }
                        Button("Skip", systemImage: "xmark") { act(s.id, ["action": "skip"]) }
                    } label: { Image(systemName: "ellipsis.circle").foregroundStyle(Theme.muted) }
                } else {
                    Text(missed ? "Missed" : s.status.capitalized).font(.caption2).foregroundStyle(missed ? Theme.warm : sessionTint(s.status))
                }
            }
            Text("\(when(s.start)) \u{00B7} \(s.minutes) min").font(.caption).foregroundStyle(Theme.muted)
            SessionBody(blocks: s.noteBlocks, extra: s.notesBlocks, summary: s.actual?.summary, url: s.actual?.url).padding(.top, 2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: Theme.rs, style: .continuous))
        .opacity(busy == s.id ? 0.5 : 1)
    }
}
