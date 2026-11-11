import Foundation
import Observation

// "Has anything changed?" for the phone. While the app is in front it asks the server for a number every few seconds; the number moves
// whenever data the app shows changes (an agent, the web, a sync). When it moves, `tick` goes up and every open screen reloads itself,
// so a change shows within seconds without reloading everything on a timer.
extension APIClient {
    func pulse() async throws -> Int {
        struct R: Decodable { let version: Int }
        return (try await get("api/v1/pulse") as R).version
    }
}

@MainActor
@Observable
final class PulseMonitor {
    static let beat: Duration = .seconds(5)
    private(set) var tick = 0
    private var last: Int?
    @ObservationIgnored private var loop: Task<Void, Never>?

    func start(_ model: AppModel) {
        stop()
        last = nil   // a change made while the app was away is caught by the reload on coming back, not here
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.beat(model)
                try? await Task.sleep(for: Self.beat)
            }
        }
    }

    func stop() { loop?.cancel(); loop = nil }

    private func beat(_ model: AppModel) async {
        guard model.signedIn, let client = model.client, let v = try? await client.pulse() else { return }
        defer { last = v }
        if let last, v != last { tick &+= 1 }
    }
}
