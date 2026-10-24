import CoreLocation
import Observation
import UIKit

// Reports where you have been, cheaply: iOS tells the app when you arrive at or leave a place (visits) and when you move a
// significant distance, even when the app is closed. Points wait in a small file until they upload, so nothing is lost offline.
//
// Trip mode adds detail only while you are moving. When you stop, a small circle (a geofence) is registered where you are; leaving
// it wakes the app, which records a point about every 30 m. Once you have stayed within about 40 m for 4 minutes it switches the
// detailed tracking off again and registers a new circle. Standing still costs almost nothing.
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
    private static let tripsKey = "location-trips"
    private static let tripActiveKey = "location-trip-active"
    private static let anchorId = "trip-anchor"
    private static let exitRadius: CLLocationDistance = 120
    private static let stillRadius: CLLocationDistance = 40
    private static let stillAfter: TimeInterval = 240
    private static let maxTrip: TimeInterval = 6 * 3600
    private static let batchSize = 20
    var enabled: Bool { didSet { UserDefaults.standard.set(enabled, forKey: Self.enabledKey); enabled ? begin() : end() } }
    var trips: Bool { didSet { UserDefaults.standard.set(trips, forKey: Self.tripsKey); if enabled { trips ? beginTrips() : endTrips() } } }
    private(set) var tripActive = false
    private(set) var status: CLAuthorizationStatus
    private(set) var pending = 0
    private(set) var lastUpload: Date?
    private(set) var error: String?
    private(set) var last: (lat: Double, lon: Double, at: Date)?
    private(set) var refreshing = false

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var queue: [Point] = []
    @ObservationIgnored private var flushing = false
    @ObservationIgnored private var manualPending = false
    @ObservationIgnored private var anchorPending = false
    @ObservationIgnored private var rest: CLLocation?
    @ObservationIgnored private var tripStarted: Date?
    @ObservationIgnored private var stillTimer: Timer?
    @ObservationIgnored private let iso = ISO8601DateFormatter()

    private override init() {
        enabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        trips = UserDefaults.standard.object(forKey: Self.tripsKey) as? Bool ?? true
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
        case .authorizedAlways: return tripActive ? "On, recording a trip" : pending > 0 ? "On, \(pending) waiting to upload" : "On"
        case .authorizedWhenInUse: return "Needs Always access"
        case .denied, .restricted: return "Blocked in Settings"
        default: return "Waiting for permission"
        }
    }

    // One exact fix right now (not the passive tracking), uploaded as a manual point. Used by the button and when the app opens.
    func refreshNow(ifOlderThan minutes: Double = 0) {
        guard enabled, status == .authorizedAlways || status == .authorizedWhenInUse, !refreshing else { return }
        if let last, Date.now.timeIntervalSince(last.at) < minutes * 60 { return }
        refreshing = true; manualPending = true
        manager.requestLocation()
    }

    // Saves where the phone last was as a named place, so stays there are labelled.
    func nameCurrentPlace(_ label: String) async -> Bool {
        guard let last, let client = Self.client else { return false }
        do { try await client.addPlace(label: label, lat: last.lat, lon: last.lon); error = nil; return true }
        catch { self.error = error.localizedDescription; return false }
    }

    private func begin() {
        status = manager.authorizationStatus
        switch status {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        case .authorizedAlways:
            manager.startMonitoringVisits()
            manager.startMonitoringSignificantLocationChanges()
            beginTrips()
            flush()
        default: break
        }
    }

    private func end() {
        manager.stopMonitoringVisits()
        manager.stopMonitoringSignificantLocationChanges()
        endTrips()
    }

    // MARK: Trip mode

    // A trip that was running when iOS relaunched the app carries on; otherwise a circle is placed where you are now.
    private func beginTrips() {
        guard enabled, trips, status == .authorizedAlways else { return }
        if UserDefaults.standard.bool(forKey: Self.tripActiveKey) { startDetailed(); return }
        if !manager.monitoredRegions.contains(where: { $0.identifier == Self.anchorId }) { anchorPending = true; manager.requestLocation() }
    }

    private func endTrips() {
        stillTimer?.invalidate(); stillTimer = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        tripActive = false
        UserDefaults.standard.set(false, forKey: Self.tripActiveKey)
        clearAnchor()
    }

    private func clearAnchor() {
        for r in manager.monitoredRegions where r.identifier == Self.anchorId { manager.stopMonitoring(for: r) }
    }

    private func setAnchor(_ c: CLLocationCoordinate2D) {
        clearAnchor()
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        let region = CLCircularRegion(center: c, radius: min(Self.exitRadius, manager.maximumRegionMonitoringDistance), identifier: Self.anchorId)
        region.notifyOnExit = true
        region.notifyOnEntry = false
        manager.startMonitoring(for: region)
    }

    private func startDetailed() {
        guard !tripActive else { return }
        clearAnchor()
        tripActive = true
        tripStarted = .now
        rest = nil
        UserDefaults.standard.set(true, forKey: Self.tripActiveKey)
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 30
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
        armStillTimer()
    }

    private func stopDetailed() {
        guard tripActive else { return }
        stillTimer?.invalidate(); stillTimer = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        tripActive = false
        UserDefaults.standard.set(false, forKey: Self.tripActiveKey)
        if let c = rest?.coordinate ?? manager.location?.coordinate { setAnchor(c) } else { anchorPending = true; manager.requestLocation() }
        rest = nil
        flush()
    }

    // Updates stop arriving when you stand still (the 30 m filter), so a timer ends the trip once you have stayed put for a while.
    private func armStillTimer() {
        stillTimer?.invalidate()
        stillTimer = Timer.scheduledTimer(withTimeInterval: Self.stillAfter, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.stopDetailed() }
        }
    }

    private func noteMovement(_ c: CLLocationCoordinate2D) {
        let here = CLLocation(latitude: c.latitude, longitude: c.longitude)
        if rest == nil || here.distance(from: rest!) > Self.stillRadius { rest = here; armStillTimer() }
        if let started = tripStarted, Date.now.timeIntervalSince(started) > Self.maxTrip { stopDetailed() }
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
            let manual = self.manualPending, anchoring = self.anchorPending
            self.manualPending = false; self.anchorPending = false; self.refreshing = false
            var detailedOnly = true
            for (t, c, a) in list {
                self.last = (c.latitude, c.longitude, t)
                if manual { self.add("mn", t, c, a, "manual"); detailedOnly = false }
                else if self.tripActive { if a >= 0 && a <= 100 { self.add("tp", t, c, a, "trip"); self.noteMovement(c) } }
                else if !anchoring { self.add("sc", t, c, a, "significant"); detailedOnly = false }
            }
            // Not on a trip: wherever this fix is becomes the circle that starts the next one.
            if (anchoring || manual), !self.tripActive, self.trips, self.enabled, let l = list.last { self.setAnchor(l.1) }
            // Trip points upload in batches; anything else goes straight away.
            if detailedOnly && self.tripActive { if self.queue.count >= Self.batchSize { self.flush() } } else { self.flush() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        let id = region.identifier
        Task { @MainActor in if id == Self.anchorId, self.enabled, self.trips { self.startDetailed() } }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {}

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.refreshing = false; self.manualPending = false; self.anchorPending = false }
    }

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
