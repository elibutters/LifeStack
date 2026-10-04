import SwiftUI

struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var profile = Loader<[ProfileEntry]>()
    @State private var conns = Loader<ConnectionsStatus>()
    var dismiss: (() -> Void)? = nil

    var body: some View {
        NavigationStack {
            List {
                Section("Profile") {
                    if let p = profile.value {
                        if p.isEmpty { Text("Nothing filled in yet. Add details on the web app's Profile page.").foregroundStyle(.secondary) }
                        ForEach(p) { LabeledContent($0.label, value: $0.value) }
                    } else if let e = profile.error { Text(e).foregroundStyle(.red) } else { ProgressView() }
                }
                Section("Connections") {
                    if let c = conns.value {
                        status(c.calendar); status(c.sleep)
                        ForEach(c.banks) { b in
                            LabeledContent(b.institution, value: b.status == "ok" ? (b.error == nil ? "Connected" : "Retrying") : "Sign in again")
                        }
                    } else if let e = conns.error { Text(e).foregroundStyle(.red) } else { ProgressView() }
                    Text("Add or fix connections on the web app's Connections page.").font(.caption).foregroundStyle(.secondary)
                }
                Section("This device") {
                    LabeledContent("Server", value: model.address)
                    Button("Sign out", role: .destructive) { model.signOut() }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .listRowBackground(Theme.card)
            .navigationTitle("Account")
            .toolbar { if let dismiss { ToolbarItem(placement: .topBarTrailing) { Button("Done", action: dismiss) } } }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func status(_ s: ConnectionsStatus.Source) -> some View { LabeledContent(s.provider, value: s.connected ? "Connected" : "Not connected") }

    private func load() async {
        async let a: Void = profile.load(model) { try await $0.profile() }
        async let b: Void = conns.load(model) { try await $0.connections() }
        _ = await (a, b)
    }
}
