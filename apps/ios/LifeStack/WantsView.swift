import SwiftUI

struct WantsView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<[Want]>()
    @State private var adding = false
    @State private var optionFor: Want?
    @State private var pricing: WantOption?
    @State private var priceText = ""
    @State private var failure: String?

    private var open: [Want] { (loader.value ?? []).filter { $0.status == "want" } }
    private var done: [Want] { (loader.value ?? []).filter { $0.status != "want" } }
    private var deals: Int { open.flatMap(\.options).filter { $0.status == "considering" && $0.atTarget }.count }

    var body: some View {
        Screen(title: "Wants", refresh: { await load() }, trailing: {
            Button { adding = true } label: { Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Theme.sky) }
                .accessibilityLabel("Add a want").accessibilityIdentifier("add-want")
        }) {
            ErrorBanner(text: failure ?? loader.error)
            if let all = loader.value {
                if all.isEmpty {
                    Card { Empty(text: "Nothing yet. Tap + to write down something you are thinking about buying. Use one want for a kind of thing, like a jacket, and add each candidate as an option.") }
                } else {
                    if !open.isEmpty { Text("\(open.count) on the lookout" + (deals > 0 ? " \u{00B7} \(deals) at target" : "")).font(.subheadline).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4) }
                    ForEach(open) { card($0) }
                    if !done.isEmpty {
                        Text("BOUGHT OR DROPPED").font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4).padding(.top, 8)
                        ForEach(done) { card($0) }
                    }
                }
            } else if loader.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
        .sheet(isPresented: $adding) { AddWantSheet { await load() } }
        .sheet(item: $optionFor) { w in AddOptionSheet(want: w) { await load() } }
        .alert("Price seen", isPresented: Binding(get: { pricing != nil }, set: { if !$0 { pricing = nil } })) {
            TextField("Dollars", text: $priceText).keyboardType(.decimalPad)
            Button("Save") { if let o = pricing { run { try await $0.updateOption(o.id, ["price": priceText]) } } }
            Button("Cancel", role: .cancel) {}
        } message: { Text(pricing?.title ?? "") }
    }

    private func load() async { await loader.load(model) { try await $0.wants() } }

    // Runs one change, then reloads. A failure shows in the banner instead of being lost.
    private func run(_ change: @escaping (APIClient) async throws -> Void) {
        Task {
            guard let client = model.client else { return }
            do { try await change(client); failure = nil; await load() }
            catch is CancellationError {}
            catch { failure = error.localizedDescription; model.handle(error) }
        }
    }

    private func money(_ cents: Int) -> String { Format.money(Double(cents) / 100, cents: cents % 100 != 0) }

    private func card(_ w: Want) -> some View {
        let live = w.status == "want"
        let solo = w.options.count <= 1
        let sub = [w.budgetCents.map { "budget \(money($0))" }, (live && !solo) ? w.bestPriceCents.map { "best \(money($0))" } : nil].compactMap { $0 }.joined(separator: " \u{00B7} ")
        return Card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(w.title).font(.headline)
                    if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(Theme.muted) }
                    if !live { Text(w.status).font(.caption).foregroundStyle(Theme.muted) }
                }
                Spacer()
                Menu {
                    if live {
                        Button("Add an option", systemImage: "plus") { optionFor = w }
                        Button("Mark bought", systemImage: "checkmark") { run { try await $0.setWantStatus(w.id, "bought") } }
                        Button("Drop", systemImage: "xmark") { run { try await $0.setWantStatus(w.id, "dropped") } }
                    } else {
                        Button("Reopen", systemImage: "arrow.uturn.backward") { run { try await $0.setWantStatus(w.id, "want") } }
                    }
                    Button("Delete", systemImage: "trash", role: .destructive) { run { try await $0.deleteWant(w.id) } }
                } label: { Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(Theme.muted).frame(width: 36, height: 36) }
                    .accessibilityLabel("Options for \(w.title)")
            }
            if let note = w.note, !note.isEmpty { Text(note).font(.subheadline).foregroundStyle(Theme.muted) }
            ForEach(w.options) { optionRow($0, live: live, solo: solo) }
            if live && w.options.isEmpty { Button { optionFor = w } label: { Label("Add an option", systemImage: "plus").font(.subheadline) }.buttonStyle(.plain).foregroundStyle(Theme.sky) }
        }
    }

    private func optionRow(_ o: WantOption, live: Bool, solo: Bool) -> some View {
        let out = o.status == "rejected"
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(o.title).font(.subheadline.weight(.medium)).strikethrough(out).foregroundStyle(out ? Theme.muted : .white).lineLimit(2)
                    if o.status == "chosen" { Text("chosen").font(.caption2).foregroundStyle(Theme.sky) }
                    if o.atTarget && !out { Text("AT TARGET").font(.caption2.weight(.bold)).foregroundStyle(Theme.good).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.good.opacity(0.16), in: Capsule()) }
                }
                Text([o.targetCents.map { "target \(money($0))" } ?? "no target", o.priceCheckedAt.map { "seen \(String($0.prefix(10)))" }].compactMap { $0 }.joined(separator: " \u{00B7} ")).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 6)
            if let p = o.priceCents { Text(money(p)).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(out ? Theme.muted : .white) }
            Menu {
                if let s = o.url, let url = URL(string: s) { Link(destination: url) { Label("Open link", systemImage: "arrow.up.right.square") } }
                if live && !out { Button("Set price", systemImage: "tag") { priceText = o.priceCents.map { String(Double($0) / 100) } ?? ""; pricing = o } }
                if live && o.status == "considering" { Button(solo ? "Mark bought" : "Pick this one", systemImage: "checkmark") { run { try await $0.updateOption(o.id, ["status": "chosen"]) } } }
                if live && !solo && o.status == "considering" { Button("Pass", systemImage: "hand.thumbsdown") { run { try await $0.updateOption(o.id, ["status": "rejected"]) } } }
                if live && out { Button("Restore", systemImage: "arrow.uturn.backward") { run { try await $0.updateOption(o.id, ["status": "considering"]) } } }
                Button("Delete", systemImage: "trash", role: .destructive) { run { try await $0.deleteOption(o.id) } }
            } label: { Image(systemName: "ellipsis").font(.body).foregroundStyle(Theme.muted).frame(width: 32, height: 32) }
                .accessibilityLabel("Actions for \(o.title)")
        }
        .padding(.vertical, 6)
    }
}

// A want, with an optional first option. One thing: fill in the price, target or link. A kind of thing: leave them and add options later.
private struct AddWantSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let done: () async -> Void
    @State private var title = ""
    @State private var price = ""
    @State private var target = ""
    @State private var url = ""
    @State private var budget = ""
    @State private var note = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("What do you want?", text: $title).accessibilityIdentifier("want-title") }
                Section("Price (optional)") {
                    TextField("Price seen", text: $price).keyboardType(.decimalPad)
                    TextField("Buy at or under", text: $target).keyboardType(.decimalPad)
                    TextField("Link", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section("About the whole want (optional)") {
                    TextField("Budget", text: $budget).keyboardType(.decimalPad)
                    TextField("Note", text: $note)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.bad) } }
            }
            .scrollContentBackground(.hidden).background(Ambient())
            .navigationTitle("New want").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add") { Task { await save() } }.disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty) }
            }
        }
    }

    private func save() async {
        guard let client = model.client else { return }
        saving = true; defer { saving = false }
        let hasOption = ![price, target, url].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        do {
            try await client.addWant(title: title, note: note, budget: budget, first: hasOption ? ["price": price, "target": target, "url": url] : nil)
            await done(); dismiss()
        } catch is CancellationError {}
        catch { self.error = "That did not save. Check the numbers and that the link starts with http." }
    }
}

private struct AddOptionSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let want: Want
    let done: () async -> Void
    @State private var title = ""
    @State private var price = ""
    @State private var target = ""
    @State private var url = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Option for \(want.title)") {
                    TextField("Which one?", text: $title)
                    TextField("Price seen", text: $price).keyboardType(.decimalPad)
                    TextField("Buy at or under", text: $target).keyboardType(.decimalPad)
                    TextField("Link", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if let error { Section { Text(error).foregroundStyle(Theme.bad) } }
            }
            .scrollContentBackground(.hidden).background(Ambient())
            .navigationTitle("New option").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add") { Task { await save() } }.disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty) }
            }
        }
    }

    private func save() async {
        guard let client = model.client else { return }
        saving = true; defer { saving = false }
        do {
            try await client.addOption(wantId: want.id, title: title, price: price, target: target, url: url)
            await done(); dismiss()
        } catch is CancellationError {}
        catch { self.error = "That did not save. Check the numbers and that the link starts with http." }
    }
}
