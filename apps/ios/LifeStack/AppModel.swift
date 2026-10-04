import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class AppModel {
    private static let addressKey = "server-address"

    var address: String = AppModel.bundledAddress ?? UserDefaults.standard.string(forKey: "server-address") ?? ""
    var signedIn: Bool
    var today: TodaySummary?
    var history: [HistoryEntry] = []
    var toast: Logged?
    var pending = false
    private var toastTask: Task<Void, Never>?
    var supplements: [String] = []
    var message: String?
    var busy = false

    // The deployment address baked in at build time (Local.xcconfig), so people never have to type one.
    static var bundledAddress: String? {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "LSBaseURL") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return raw.isEmpty || raw.contains("$(") ? nil : raw
    }

    init() {
        signedIn = Keychain.read() != nil && !(Self.bundledAddress ?? UserDefaults.standard.string(forKey: Self.addressKey) ?? "").isEmpty
    }

    var client: APIClient? {
        guard let url = APIClient.parse(address: address), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    // The email and password are sent once, to trade for this device's own key; only the key is kept (in the Keychain).
    func signIn(address: String, email: String, password: String) async {
        message = nil
        guard let url = APIClient.parse(address: Self.bundledAddress ?? address) else { message = APIError.badAddress.localizedDescription; return }
        busy = true; defer { busy = false }
        do {
            let key = try await APIClient.login(base: url, email: email, password: password, device: UIDevice.current.name)
            guard Keychain.save(key) else { message = "Could not store the key on this device."; return }
            self.address = url.absoluteString
            UserDefaults.standard.set(self.address, forKey: Self.addressKey)
            signedIn = true
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func signOut() {
        Keychain.delete()
        today = nil; supplements = []; message = nil; signedIn = false
    }

    func refresh() async {
        guard let client else { return }
        // The supplement list is a nicety: if it cannot load, the rest of the screen still works.
        async let names = try? client.supplementNames()
        async let feed = try? client.history()
        do {
            today = try await client.today()
            message = nil
        } catch { handle(error) }
        if let names = await names { supplements = names }
        if let feed = await feed { history = feed }
    }

    // One tap logs. The confirmation stays for a few seconds with Undo, like the web app, and more taps are
    // ignored while a request is in flight so a double tap cannot log twice.
    func log(_ event: [String: Any], label: String) async -> Bool {
        guard let client, !pending else { return false }
        pending = true; defer { pending = false }
        do {
            let id = try await client.log(event)
            show(Logged(id: id, label: label))
            await refresh()
            return true
        } catch { handle(error); return false }
    }

    func undo(_ entry: Logged) async {
        guard let client else { return }
        toastTask?.cancel(); toast = nil
        do { try await client.deleteEntry(entry.id); await refresh() } catch { handle(error) }
    }

    func remove(_ entry: HistoryEntry) async {
        guard let client else { return }
        do { try await client.deleteEntry(entry.id); await refresh() } catch { handle(error) }
    }

    private func show(_ entry: Logged) {
        toastTask?.cancel()
        toast = entry
        toastTask = Task { try? await Task.sleep(for: .seconds(6)); if !Task.isCancelled { toast = nil } }
    }

    // A rejected key means this device was revoked or the password changed: go back to sign in.
    func handle(_ error: Error) {
        if case APIError.unauthorized = error { signOut(); message = error.localizedDescription } else { message = error.localizedDescription }
    }
}

// Loads one screen's data and keeps the last good copy if a refresh fails.
@MainActor
@Observable
final class Loader<T> {
    var value: T?
    var error: String?
    var loading = false

    func load(_ model: AppModel, _ fetch: @escaping (APIClient) async throws -> T) async {
        guard let client = model.client else { return }
        loading = true; defer { loading = false }
        do { value = try await fetch(client); error = nil }
        catch { self.error = error.localizedDescription; model.handle(error) }
    }
}
