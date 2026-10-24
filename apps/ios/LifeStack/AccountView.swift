import SwiftUI

struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var profile = Loader<[ProfileEntry]>()
    @State private var conns = Loader<ConnectionsStatus>()
    @State private var naming = false
    @State private var placeName = ""
    @State private var nameMessage: String?
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
                Section("Location") {
                    @Bindable var tracker = LocationTracker.shared
                    Toggle("Record places and trips", isOn: $tracker.enabled).accessibilityIdentifier("location-toggle")
                    LabeledContent("Status", value: tracker.summary)
                    Toggle("Detailed trips", isOn: $tracker.trips).accessibilityIdentifier("location-trips")
                    if tracker.enabled {
                        Button(tracker.refreshing ? "Locating..." : "Update my location now") { tracker.refreshNow() }.disabled(tracker.refreshing)
                            .accessibilityIdentifier("location-refresh")
                        if let l = tracker.last {
                            LabeledContent("Last fix", value: l.at.formatted(date: .omitted, time: .shortened))
                            Button("Name this place") { placeName = ""; naming = true }
                        }
                        if let m = nameMessage { Text(m).font(.caption).foregroundStyle(.secondary) }
                    }
                    if tracker.status == .denied || tracker.status == .authorizedWhenInUse {
                        Button("Open Settings") { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
                    }
                    Text("Always keeps iOS's low-power visit tracking. Detailed trips adds a point about every 30 m, but only while you are moving, and turns itself off when you stop. Choose Always in Settings so it works with the app closed. Stored in your own database.").font(.caption).foregroundStyle(.secondary)
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
            .alert("Name this place", isPresented: $naming) {
                TextField("Home, Gym, Office", text: $placeName)
                Button("Save") {
                    let name = placeName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    Task { nameMessage = await LocationTracker.shared.nameCurrentPlace(name) ? "Saved \(name)." : "Could not save that place." }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Visits near here will be labelled with this name.") }
        }
    }

    private func status(_ s: ConnectionsStatus.Source) -> some View { LabeledContent(s.provider, value: s.connected ? "Connected" : "Not connected") }

    private func load() async {
        async let a: Void = profile.load(model) { try await $0.profile() }
        async let b: Void = conns.load(model) { try await $0.connections() }
        _ = await (a, b)
    }
}
