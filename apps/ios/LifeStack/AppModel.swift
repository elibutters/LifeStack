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
    var pending = false
    var options: LogOptions?
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
        today = nil; options = nil; history = []; message = nil; signedIn = false
    }

    func refresh() async {
        guard let client else { return }
        // The supplement list is a nicety: if it cannot load, the rest of the screen still works.
        async let opts = try? client.options()
        async let feed = try? client.history()
        do {
            today = try await client.today()
            message = nil
        } catch { handle(error) }
        if let opts = await opts { options = opts }
        if let feed = await feed { history = feed }
    }

    // One tap logs. More taps are ignored while a request is in flight, so a double tap cannot log twice.
    func log(_ event: [String: Any], label: String) async -> Bool {
        guard let client, !pending else { return false }
        pending = true; defer { pending = false }
        do {
            _ = try await client.log(event)
            await refresh()
            return true
        } catch { handle(error); return false }
    }

    // Today's entry for a supplement, if it was taken: a supplement is taken or not, never counted.
    func takenToday(_ name: String) -> HistoryEntry? {
        history.first { $0.key == "supplement.taken" && Format.isToday($0.at) && ($0.name ?? "").caseInsensitiveCompare(name) == .orderedSame }
    }

    // Tap to take, tap again to un-take.
    func toggleSupplement(_ s: LogOptions.Supplement) async -> Bool {
        guard let client, !pending else { return false }
        pending = true; defer { pending = false }
        do {
            if let taken = takenToday(s.name) {
                try await client.deleteEntry(taken.id)
            } else {
                var event: [String: Any] = ["type": "supplement", "name": s.name]
                if let d = s.dose { event["dose"] = d }; if let u = s.unit { event["unit"] = u }
                _ = try await client.log(event)
            }
            await refresh()
            return true
        } catch { handle(error); return false }
    }

    func setDose(_ s: LogOptions.Supplement, dose: Double?, unit: String) async {
        guard let client else { return }
        do { try await client.setDose(id: s.id, dose: dose, unit: unit) } catch { handle(error) }
    }

    func remove(_ entry: HistoryEntry) async {
        guard let client else { return }
        do { try await client.deleteEntry(entry.id); await refresh() } catch { handle(error) }
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
