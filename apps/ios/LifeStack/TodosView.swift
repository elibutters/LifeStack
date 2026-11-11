import SwiftUI

// The website's to-do list: open items grouped by due date, then done and dropped folded away.
struct Todo: Decodable, Identifiable, Equatable {
    let id: Int
    let title: String
    let note: String?
    let status: String   // open | done | dropped
    let due: String?     // YYYY-MM-DD
    let source: String   // web | agent | app
    let createdAt: String
    let completedAt: String?

    func withStatus(_ status: String) -> Todo {
        Todo(id: id, title: title, note: note, status: status, due: due, source: source, createdAt: createdAt, completedAt: status == "done" ? completedAt : nil)
    }
}

// These calls stay with the screen. APIClient.swift is also built into the widgets, which do not need the list.
extension APIClient {
    func todos() async throws -> [Todo] {
        struct R: Decodable { let todos: [Todo] }
        return (try await get("api/v1/todos") as R).todos
    }
    func addTodo(title: String, note: String, due: String) async throws {
        try await writeTodo("api/v1/todos", "POST", ["title": title, "note": note, "due": due])
    }
    func updateTodo(_ id: Int, _ fields: [String: Any]) async throws {
        try await writeTodo("api/v1/todos/\(id)", "PATCH", fields)
    }
    func deleteTodo(_ id: Int) async throws {
        _ = try await request("api/v1/todos/\(id)", method: "DELETE")
    }
    private func writeTodo(_ path: String, _ method: String, _ body: [String: Any]) async throws {
        _ = try await request(path, method: method, body: try JSONSerialization.data(withJSONObject: body))
    }
}

// Open items split the same way as the website: overdue, today, later, then no date.
private enum TodoBucket: String, CaseIterable {
    case overdue = "Overdue", today = "Today", upcoming = "Upcoming", anytime = "No date"
    func holds(_ due: String?, today: String) -> Bool {
        switch self {
        case .anytime: due == nil
        case .overdue: due.map { $0 < today } ?? false
        case .today: due == today
        case .upcoming: due.map { $0 > today } ?? false
        }
    }
}

private func todoDay(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
}

private func parseTodoDay(_ s: String) -> Date? {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: String(s.prefix(10)))
}

private func shiftTodoDay(_ day: String, by n: Int) -> String {
    guard let d = parseTodoDay(day), let next = Calendar.current.date(byAdding: .day, value: n, to: d) else { return day }
    return todoDay(next)
}

private func plainTodoDay(_ due: String, today: String) -> String {
    guard let d = parseTodoDay(due) else { return due }
    if due.prefix(4) == today.prefix(4) { return d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
    return d.formatted(.dateTime.month(.abbreviated).day().year())
}

// Today, tomorrow and yesterday are words. Anything else is a date, red once it has passed.
private func dueLabel(_ due: String, today: String, relative: Bool) -> (String, Color) {
    if !relative { return (plainTodoDay(due, today: today), Theme.muted) }
    if due == today { return ("Today", Theme.accent) }
    if due == shiftTodoDay(today, by: 1) { return ("Tomorrow", .white) }
    if due == shiftTodoDay(today, by: -1) { return ("Yesterday", Theme.bad) }
    if due < today { return (plainTodoDay(due, today: today), Theme.bad) }
    return (plainTodoDay(due, today: today), Theme.muted)
}

struct TodosView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<[Todo]>()
    @State private var adding = false
    @State private var editing: Todo?
    @State private var showDone = false
    @State private var showDropped = false
    @State private var failure: String?

    var body: some View {
        let today = todoDay(.now)
        Screen(title: "To do", refresh: { await load() }, trailing: {
            Button { adding = true } label: { Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Theme.accent) }
                .accessibilityLabel("Add a to-do").accessibilityIdentifier("add-todo")
        }) {
            ErrorBanner(text: failure ?? loader.error)
            if let items = loader.value {
                if items.isEmpty {
                    Card { Empty(text: "Nothing yet. Tap + to add something that needs doing.") }
                } else {
                    summary(items, today: today)
                    board(items, today: today)
                }
            } else if loader.loading {
                ProgressView().padding(.top, 60)
            }
        }
        .task { await load() }
        .sheet(isPresented: $adding) { TodoEditor(todo: nil) { failure = nil; await load() } }
        .sheet(item: $editing) { t in TodoEditor(todo: t) { failure = nil; await load() } }
    }

    private func load() async { await loader.load(model) { try await $0.todos() } }

    private func run(_ change: @escaping (APIClient) async throws -> Void) {
        Task {
            guard let client = model.client else { return }
            do { try await change(client); failure = nil }
            catch is CancellationError { return }
            catch { failure = error.localizedDescription; model.handle(error) }
            await load()
        }
    }

    private func toggle(_ t: Todo) {
        let next = t.status == "open" ? "done" : "open"
        if var items = loader.value, let i = items.firstIndex(where: { $0.id == t.id }) {
            items[i] = t.withStatus(next)
            withAnimation(.easeInOut(duration: 0.15)) { loader.value = items }
        }
        run { try await $0.updateTodo(t.id, ["status": next]) }
    }

    private func summary(_ items: [Todo], today: String) -> some View {
        let open = items.filter { $0.status == "open" }
        let overdue = open.filter { $0.due.map { $0 < today } ?? false }.count
        return HStack(spacing: 0) {
            Text(open.isEmpty ? "Nothing open" : "\(open.count) open").foregroundStyle(Theme.muted)
            if overdue > 0 {
                Text(" · ").foregroundStyle(Theme.muted)
                Text("\(overdue) overdue").foregroundStyle(Theme.bad)
            }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }

    private func board(_ items: [Todo], today: String) -> some View {
        let open = items.filter { $0.status == "open" }
        let groups = TodoBucket.allCases.compactMap { bucket -> (TodoBucket, [Todo])? in
            let list = open.filter { bucket.holds($0.due, today: today) }
            return list.isEmpty ? nil : (bucket, list)
        }
        let done = items.filter { $0.status == "done" }
        let dropped = items.filter { $0.status == "dropped" }
        let showHeads = groups.count > 1
        return Card {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(groups.enumerated()), id: \.element.0.rawValue) { i, group in
                    if i > 0 { line.padding(.top, 8) }
                    if showHeads {
                        HStack(spacing: 6) {
                            Text(group.0.rawValue).foregroundStyle(group.0 == .overdue ? Theme.bad : Theme.muted)
                            Text("\(group.1.count)").foregroundStyle(Theme.muted).monospacedDigit()
                        }
                        .font(.caption.weight(.medium))
                        .padding(.leading, 44)
                        .padding(.top, i == 0 ? 2 : 10)
                        .padding(.bottom, 2)
                        .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(group.1.enumerated()), id: \.element.id) { j, t in
                        if j > 0 { line }
                        row(t, today: today, section: group.0, showHeads: showHeads)
                    }
                }
                if !done.isEmpty {
                    if !groups.isEmpty { line.padding(.top, 4) }
                    fold("Done", items: done, open: showDone, today: today) { withAnimation(.easeInOut(duration: 0.15)) { showDone.toggle() } }
                }
                if !dropped.isEmpty {
                    if !groups.isEmpty || !done.isEmpty { line.padding(.top, 4) }
                    fold("Dropped", items: dropped, open: showDropped, today: today) { withAnimation(.easeInOut(duration: 0.15)) { showDropped.toggle() } }
                }
            }
        }
    }

    private func fold(_ label: String, items: [Todo], open: Bool, today: String, toggle: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 0) {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .frame(width: 44, height: 44)
                    Text(label)
                    Text("\(items.count)").monospacedDigit().padding(.leading, 8)
                    Spacer()
                }
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("\(label), \(items.count)")
            .accessibilityValue(open ? "Expanded" : "Collapsed")
            if open {
                ForEach(items) { t in
                    line
                    row(t, today: today, section: nil, showHeads: false)
                }
            }
        }
    }

    private func row(_ t: Todo, today: String, section: TodoBucket?, showHeads: Bool) -> some View {
        let when: (String, Color)? = {
            guard let due = t.due, !(section == .today && showHeads) else { return nil }
            return dueLabel(due, today: today, relative: section != nil)
        }()
        return HStack(alignment: .center, spacing: 0) {
            Button { toggle(t) } label: { TodoMark(status: t.status) }
                .buttonStyle(.plain)
                .accessibilityLabel(t.status == "open" ? "Mark \(t.title) done" : "Reopen \(t.title)")
                .accessibilityIdentifier("todo-toggle-\(t.id)")
            Button { editing = t } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.title)
                            .font(.body)
                            .multilineTextAlignment(.leading)
                            .strikethrough(t.status == "done", color: Theme.muted)
                            .foregroundStyle(t.status == "open" ? Color.white : Theme.muted)
                        if let note = t.note, !note.isEmpty {
                            Text(note).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(2).multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let when {
                        Text(when.0).font(.subheadline).foregroundStyle(when.1).monospacedDigit().lineLimit(1)
                    }
                }
                .padding(.vertical, 10)
                .padding(.trailing, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("todo-\(t.id)")
        }
    }

    private var line: some View { Rectangle().fill(Theme.line).frame(height: 1) }
}

private struct TodoMark: View {
    let status: String
    private var done: Bool { status == "done" }
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .fill(done ? Color.white : Color.clear)
                .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(done ? Color.white : Theme.muted, lineWidth: 1.5) }
                .frame(width: 18, height: 18)
            if done {
                Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.black)
            } else if status == "dropped" {
                Capsule().fill(Theme.muted).frame(width: 8, height: 1.5)
            }
        }
        .frame(width: 44, height: 44)
    }
}

private struct TodoEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusTitle: Bool
    let todo: Todo?
    let done: () async -> Void
    @State private var title: String
    @State private var note: String
    @State private var hasDue: Bool
    @State private var due: Date
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var error: String?

    init(todo: Todo?, done: @escaping () async -> Void) {
        self.todo = todo
        self.done = done
        _title = State(initialValue: todo?.title ?? "")
        _note = State(initialValue: todo?.note ?? "")
        let day = todo?.due.flatMap(parseTodoDay)
        _hasDue = State(initialValue: day != nil)
        _due = State(initialValue: day ?? .now)
    }

    private var titleText: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var noteText: String { note.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dueText: String { hasDue ? todoDay(due) : "" }
    private var titleOK: Bool { !titleText.isEmpty && titleText.count <= 200 }
    private var dirty: Bool {
        guard let todo else { return true }
        return titleText != todo.title || noteText != (todo.note ?? "") || dueText != (todo.due ?? "")
    }
    private var canSave: Bool { titleOK && (todo == nil || dirty) }
    private var sourceLabel: String? {
        switch todo?.source {
        case "agent": "Added by an agent"
        case "app": "Added in the app"
        default: nil
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What needs doing", text: $title)
                        .focused($focusTitle)
                        .accessibilityIdentifier("todo-title")
                        .onChange(of: title) { _, v in if v.count > 200 { title = String(v.prefix(200)) } }
                    TextField("Note", text: $note, axis: .vertical)
                        .lineLimit(2...6)
                        .onChange(of: note) { _, v in if v.count > 2000 { note = String(v.prefix(2000)) } }
                }
                Section {
                    Toggle("Due date", isOn: $hasDue)
                    if hasDue { DatePicker("Due", selection: $due, displayedComponents: .date).datePickerStyle(.compact) }
                } footer: {
                    if let sourceLabel { Text(sourceLabel) }
                }
                if todo != nil {
                    Section {
                        if todo?.status == "open" {
                            Button("Drop") { Task { await save(status: "dropped") } }.disabled(saving || !titleOK)
                        }
                        Button("Delete", role: .destructive) { confirmDelete = true }.disabled(saving)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.bad) } }
            }
            .scrollContentBackground(.hidden).background(Ambient()).scrollDismissesKeyboard(.interactively)
            .tint(Theme.accent)
            .navigationTitle(todo == nil ? "New to-do" : "Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(todo == nil ? "Add" : "Save") { Task { await save() } }.disabled(saving || !canSave)
                }
            }
            .onAppear { focusTitle = true }
            .confirmationDialog("Delete this to-do?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await remove() } }
                Button("Cancel", role: .cancel) {}
            } message: { Text(titleText) }
        }
    }

    private func fields(status: String?) -> [String: Any] {
        var body: [String: Any] = ["title": titleText, "note": noteText, "due": dueText]
        if let status { body["status"] = status }
        return body
    }

    private func save(status: String? = nil) async {
        guard !saving, titleOK, let client = model.client else { return }
        if status == nil, todo != nil, !dirty { return }
        saving = true
        defer { saving = false }
        do {
            if let todo { try await client.updateTodo(todo.id, fields(status: status)) }
            else { try await client.addTodo(title: titleText, note: noteText, due: dueText) }
            await done()
            dismiss()
        } catch is CancellationError {}
        catch { self.error = error.localizedDescription; model.handle(error) }
    }

    private func remove() async {
        guard !saving, let client = model.client, let todo else { return }
        saving = true
        defer { saving = false }
        do {
            try await client.deleteTodo(todo.id)
            await done()
            dismiss()
        } catch is CancellationError {}
        catch { self.error = error.localizedDescription; model.handle(error) }
    }
}
