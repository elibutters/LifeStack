import SwiftUI

// The same list as the web To do page and the agent tools. The phone key already has log:read and log:write.
struct TodosView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<[TodoItem]>()
    @State private var adding = false
    @State private var failure: String?

    private var items: [TodoItem] { loader.value ?? [] }
    private var open: [TodoItem] { items.filter(\.isOpen) }
    private var closed: [TodoItem] { items.filter { !$0.isOpen } }
    private var overdue: Int { open.filter(\.overdue).count }

    var body: some View {
        Screen(title: "To do", refresh: { await load() }, trailing: {
            Button { adding = true } label: { Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Theme.accent) }
                .accessibilityLabel("Add a to-do").accessibilityIdentifier("add-todo")
        }) {
            ErrorBanner(text: failure ?? loader.error)
            if loader.value != nil {
                Text(summaryLine).font(.subheadline).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                Card(title: "Open") {
                    if open.isEmpty { Empty(text: "Nothing open.") }
                    else { rows(open) }
                }
                if !closed.isEmpty {
                    Card(title: "Done or dropped") { rows(closed) }
                }
            } else if loader.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
        .sheet(isPresented: $adding) { AddTodoSheet { await load() } }
    }

    private var summaryLine: String {
        let n = open.count
        return "\(n) open" + (overdue > 0 ? " · \(overdue) overdue" : "")
    }

    private func rows(_ list: [TodoItem]) -> some View {
        VStack(spacing: 0) {
            ForEach(list) { item in
                row(item)
                if item.id != list.last?.id { Divider().overlay(Theme.line) }
            }
        }
    }

    private func row(_ t: TodoItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(t.title).font(.subheadline.weight(.medium)).strikethrough(!t.isOpen).foregroundStyle(t.isOpen ? .white : Theme.muted)
                if t.note != nil || t.due != nil {
                    Text(meta(t)).font(.caption).foregroundStyle(t.overdue ? Theme.bad : Theme.muted)
                }
            }
            Spacer(minLength: 6)
            Menu {
                if t.isOpen {
                    Button("Done", systemImage: "checkmark") { run { try await $0.setTodoStatus(t.id, "done") } }
                    Button("Drop", systemImage: "minus.circle") { run { try await $0.setTodoStatus(t.id, "dropped") } }
                } else {
                    Button("Reopen", systemImage: "arrow.uturn.backward") { run { try await $0.setTodoStatus(t.id, "open") } }
                }
                Button("Delete", systemImage: "trash", role: .destructive) { run { try await $0.deleteTodo(t.id) } }
            } label: {
                Image(systemName: "ellipsis").font(.body).foregroundStyle(Theme.muted).frame(width: 32, height: 32)
            }
            .accessibilityLabel("Options for \(t.title)")
        }
        .padding(.vertical, 8)
    }

    private func meta(_ t: TodoItem) -> String {
        var parts: [String] = []
        if let due = t.due { parts.append(t.overdue ? "due \(Format.shortDay(due)) · overdue" : "due \(Format.shortDay(due))") }
        if let note = t.note, !note.isEmpty { parts.append(note) }
        if !t.isOpen { parts.append(t.status) }
        return parts.joined(separator: " · ")
    }

    private func load() async { await loader.load(model) { try await $0.todos() } }

    private func run(_ work: @escaping (APIClient) async throws -> Void) {
        guard let client = model.client else { return }
        Task {
            do { try await work(client); failure = nil; await load() }
            catch is CancellationError {}
            catch { failure = error.localizedDescription; model.handle(error) }
        }
    }
}

private struct AddTodoSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let done: () async -> Void
    @State private var title = ""
    @State private var note = ""
    @State private var hasDue = false
    @State private var due = Date()
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("What needs doing?", text: $title).accessibilityIdentifier("todo-title") }
                Section {
                    TextField("Note", text: $note)
                    Toggle("Due date", isOn: $hasDue)
                    if hasDue { DatePicker("Due", selection: $due, displayedComponents: .date) }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.bad) } }
            }
            .scrollContentBackground(.hidden).background(Ambient())
            .navigationTitle("New to-do").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await save() } }.disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private static func dayString(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        return f.string(from: date)
    }

    private func save() async {
        guard let client = model.client else { return }
        saving = true; defer { saving = false }
        let day: String? = hasDue ? Self.dayString(due) : nil
        do {
            try await client.addTodo(title: title, note: note, due: day)
            await done(); dismiss()
        } catch is CancellationError {}
        catch { self.error = "That did not save. A title is required, and a due date has to be a real date." }
    }
}
