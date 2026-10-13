import CoreLocation
import Observation
import UIKit

// Reports where you have been, cheaply: iOS tells the app when you arrive at or leave a place (visits) and when you move a
// significant distance, even when the app is closed. Points wait in a small file until they upload, so nothing is lost offline.
@MainActor
@Observable
final class LocationTracker: NSObject, CLLocationManagerDelegate {
    static let shared = LocationTracker()

    struct Point: Codable, Equatable {
        let id: String
        let at: String
        let lat: Double
        let lon: Double
        let accuracyM: Double?
        let source: String
    }

    private static let enabledKey = "location-enabled"
    var enabled: Bool { didSet { UserDefaults.standard.set(enabled, forKey: Self.enabledKey); enabled ? begin() : end() } }
    private(set) var status: CLAuthorizationStatus
    private(set) var pending = 0
    private(set) var lastUpload: Date?
    private(set) var error: String?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var queue: [Point] = []
    @ObservationIgnored private var flushing = false
    @ObservationIgnored private let iso = ISO8601DateFormatter()

    private override init() {
        enabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        queue = Self.loadQueue()
        pending = queue.count
    }

    // Called at launch. iOS relaunches the app in the background for a visit or move, which comes through here too.
    func startIfEnabled() { if enabled { begin() } }

    var summary: String {
        if !enabled { return "Off" }
        switch status {
        case .authorizedAlways: return pending > 0 ? "On, \(pending) waiting to upload" : "On"
        case .authorizedWhenInUse: return "Needs Always access"
        case .denied, .restricted: return "Blocked in Settings"
        default: return "Waiting for permission"
        }
    }

    private func begin() {
        status = manager.authorizationStatus
        switch status {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        case .authorizedAlways:
            manager.startMonitoringVisits()
            manager.startMonitoringSignificantLocationChanges()
            flush()
        default: break
        }
    }

    private func end() {
        manager.stopMonitoringVisits()
        manager.stopMonitoringSignificantLocationChanges()
    }

    // MARK: Delegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.status = manager.authorizationStatus; if self.enabled { self.begin() } }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        let c = visit.coordinate, acc = visit.horizontalAccuracy, arrival = visit.arrivalDate, departure = visit.departureDate
        Task { @MainActor in
            if arrival != .distantPast { self.add("va", arrival, c, acc, "visit-arrival") }
            if departure != .distantFuture { self.add("vd", departure, c, acc, "visit-departure") }
            self.flush()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let list = locations.map { ($0.timestamp, $0.coordinate, $0.horizontalAccuracy) }
        Task { @MainActor in
            for (t, c, a) in list { self.add("sc", t, c, a, "significant") }
            self.flush()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    // MARK: Queue

    // The id comes from the time and place, so a visit reported twice (once on arrival, again on departure) is stored once.
    private func add(_ kind: String, _ at: Date, _ c: CLLocationCoordinate2D, _ accuracy: Double, _ source: String) {
        guard CLLocationCoordinate2DIsValid(c) else { return }
        let id = "\(kind)-\(Int(at.timeIntervalSince1970))-\(Int(abs(c.latitude) * 1e4))-\(Int(abs(c.longitude) * 1e4))"
        guard !queue.contains(where: { $0.id == id }) else { return }
        queue.append(Point(id: id, at: iso.string(from: at), lat: c.latitude, lon: c.longitude, accuracyM: accuracy >= 0 ? accuracy : nil, source: source))
        pending = queue.count
        save()
    }

    func flush() {
        guard !flushing, !queue.isEmpty, let client = Self.client else { return }
        flushing = true
        let batch = Array(queue.prefix(200))
        let bg = UIApplication.shared.beginBackgroundTask(withName: "location-upload")
        Task {
            defer { UIApplication.shared.endBackgroundTask(bg) }
            do {
                try await client.sendLocations(batch.map { ["id": $0.id, "at": $0.at, "lat": $0.lat, "lon": $0.lon, "source": $0.source].merging($0.accuracyM.map { ["accuracyM": $0] } ?? [:]) { a, _ in a } })
                queue.removeAll { p in batch.contains { $0.id == p.id } }
                pending = queue.count; lastUpload = .now; error = nil
                save()
                flushing = false
                if !queue.isEmpty { flush() }
            } catch {
                self.error = error.localizedDescription
                flushing = false
            }
        }
    }

    private static var client: APIClient? {
        guard let key = Keychain.read(), let url = APIClient.parse(address: AppModel.bundledAddress ?? UserDefaults.standard.string(forKey: "server-address") ?? "") else { return nil }
        return APIClient(base: url, key: key)
    }

    private static var queueURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("location-queue.json")
    }
    private static func loadQueue() -> [Point] { (try? JSONDecoder().decode([Point].self, from: Data(contentsOf: queueURL))) ?? [] }
    private func save() { try? JSONEncoder().encode(queue).write(to: Self.queueURL, options: .atomic) }

    // Signing out removes the key; anything still queued is dropped too, so the next account never receives it.
    func clearQueue() { queue = []; pending = 0; save() }
}
