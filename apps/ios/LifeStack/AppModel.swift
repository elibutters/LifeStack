import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    private static let addressKey = "server-address"

    var address: String = UserDefaults.standard.string(forKey: addressKey) ?? ""
    var signedIn: Bool
    var today: TodaySummary?
    var supplements: [String] = []
    var message: String?
    var busy = false

    private var client: APIClient? {
        guard let url = APIClient.parse(address: address), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    init() {
        signedIn = Keychain.read() != nil && !(UserDefaults.standard.string(forKey: Self.addressKey) ?? "").isEmpty
    }

    func signIn(address: String, key: String) async {
        message = nil
        guard let url = APIClient.parse(address: address) else { message = APIError.badAddress.localizedDescription; return }
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient(base: url, key: trimmed).today()
            guard Keychain.save(trimmed) else { message = "Could not store the key on this device."; return }
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
        do {
            today = try await client.today()
            message = nil
        } catch { handle(error) }
        if let names = await names { supplements = names }
    }

    func log(_ event: [String: Any]) async -> Bool {
        guard let client else { return false }
        do {
            try await client.log(event)
            await refresh()
            return true
        } catch { handle(error); return false }
    }

    private func handle(_ error: Error) {
        if case APIError.unauthorized = error { signOut(); message = error.localizedDescription } else { message = error.localizedDescription }
    }
}
