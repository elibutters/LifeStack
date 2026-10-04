import Foundation
import LocalAuthentication
import Observation
import UIKit

@MainActor
@Observable
final class AppModel {
    private static let addressKey = "server-address"

    var address: String = UserDefaults.standard.string(forKey: addressKey) ?? ""
    var signedIn: Bool
    var locked: Bool
    var today: TodaySummary?
    var supplements: [String] = []
    var message: String?
    var busy = false

    // Debug builds only: the automated UI test cannot pass Face ID, so it launches with this argument.
    private static var lockDisabledForTests: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-uitest-no-lock")
        #else
        false
        #endif
    }

    init() {
        let on = Keychain.read() != nil && !(UserDefaults.standard.string(forKey: Self.addressKey) ?? "").isEmpty
        signedIn = on
        locked = on && !Self.lockDisabledForTests
    }

    var client: APIClient? {
        guard let url = APIClient.parse(address: address), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    // The password is sent once, to trade for this device's own key; only the key is kept (in the Keychain).
    func signIn(address: String, password: String) async {
        message = nil
        guard let url = APIClient.parse(address: address) else { message = APIError.badAddress.localizedDescription; return }
        busy = true; defer { busy = false }
        do {
            let key = try await APIClient.login(base: url, password: password, device: UIDevice.current.name)
            guard Keychain.save(key) else { message = "Could not store the key on this device."; return }
            self.address = url.absoluteString
            UserDefaults.standard.set(self.address, forKey: Self.addressKey)
            signedIn = true
            locked = false
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func signOut() {
        Keychain.delete()
        today = nil; supplements = []; message = nil; signedIn = false; locked = false
    }

    // Face ID, or the device passcode as the fallback. A device with no lock set has nothing to enforce.
    func unlock() async {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { locked = false; return }
        if (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Life Stack")) == true { locked = false }
    }

    func lock() { if signedIn && !Self.lockDisabledForTests { locked = true } }

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
