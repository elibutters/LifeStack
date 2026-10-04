import Foundation

struct TodaySummary: Decodable, Equatable {
    struct Mood: Decodable, Equatable { let value: Int; let count: Int }
    struct Caffeine: Decodable, Equatable { let count: Int; let mg: Double }
    struct Supplement: Decodable, Equatable { let name: String; let count: Int }
    let date: String
    let mood: Mood?
    let caffeine: Caffeine
    let supplements: [Supplement]
}

enum APIError: LocalizedError {
    case badAddress, unauthorized, needsReadAccess, offline, server, wrongPassword, tooManyAttempts

    var errorDescription: String? {
        switch self {
        case .badAddress: "That address does not look right. Use the https address of your deployment."
        case .unauthorized: "The key was not accepted. Check it was copied in full and has not been revoked."
        case .needsReadAccess: "This key can only add logs. Make one with read access too."
        case .offline: "Could not reach the server. Check your connection."
        case .server: "The server had a problem. Try again shortly."
        case .wrongPassword: "Wrong email or password."
        case .tooManyAttempts: "Too many attempts. Try again in 15 minutes."
        }
    }
}

// Talks to /api/v1 with a bearer key. Plain https only, except for a development server on this machine.
struct APIClient {
    let base: URL
    let key: String

    static func parse(address: String) -> URL? {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.contains("://") { text = "https://" + text }
        guard var parts = URLComponents(string: text), let host = parts.host, !host.isEmpty else { return nil }
        let local = host == "localhost" || host == "127.0.0.1"
        guard parts.scheme == "https" || (parts.scheme == "http" && local) else { return nil }
        parts.path = ""; parts.query = nil; parts.fragment = nil; parts.user = nil; parts.password = nil
        return parts.url
    }

    private func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET", body: Data? = nil) async throws -> Data {
        var url = base.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = method
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.offline }
        guard let http = response as? HTTPURLResponse else { throw APIError.server }
        switch http.statusCode {
        case 200, 201: return data
        case 401: throw APIError.unauthorized
        case 403: throw APIError.needsReadAccess
        default: throw APIError.server
        }
    }

    private func get<T: Decodable>(_ path: String, _ query: [URLQueryItem] = []) async throws -> T {
        do { return try JSONDecoder().decode(T.self, from: try await request(path, query: query)) }
        catch let e as APIError { throw e } catch { throw APIError.server }
    }

    // The one time the password is sent: it is traded for this device's own key and never stored.
    static func login(base: URL, email: String, password: String, device: String) async throws -> String {
        var req = URLRequest(url: base.appending(path: "api/v1/auth/login"), timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password, "device": device])
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.offline }
        guard let http = response as? HTTPURLResponse else { throw APIError.server }
        switch http.statusCode {
        case 200:
            struct R: Decodable { let token: String }
            guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.server }
            return r.token
        case 401: throw APIError.wrongPassword
        case 429: throw APIError.tooManyAttempts
        default: throw APIError.server
        }
    }

    func overview() async throws -> Overview { try await get("api/v1/overview") }
    func calendar(days: Int = 30) async throws -> [CalendarItem] {
        struct R: Decodable { let items: [CalendarItem] }
        let from = Date(), to = Calendar.current.date(byAdding: .day, value: days, to: from) ?? from
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let r: R = try await get("api/v1/calendar", [.init(name: "from", value: f.string(from: from)), .init(name: "to", value: f.string(from: to))])
        return r.items
    }
    func sleep(nights: Int = 14) async throws -> [Night] {
        struct R: Decodable { let nights: [Night] }
        return (try await get("api/v1/sleep", [.init(name: "nights", value: String(nights))]) as R).nights
    }
    func finance() async throws -> FinanceSummary { try await get("api/v1/finance") }
    func transactions(limit: Int = 30) async throws -> [Transaction] {
        struct R: Decodable { let transactions: [Transaction] }
        return (try await get("api/v1/finance/transactions", [.init(name: "limit", value: String(limit))]) as R).transactions
    }
    func holdings() async throws -> [Holding] {
        struct R: Decodable { let holdings: [Holding] }
        return (try await get("api/v1/finance/holdings") as R).holdings
    }
    func connections() async throws -> ConnectionsStatus { try await get("api/v1/connections") }
    func profile() async throws -> [ProfileEntry] {
        let data = try await request("api/v1/profile")
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw APIError.server }
        return obj.keys.sorted().compactMap { k in
            let v = obj[k]
            let text: String? = (v as? String) ?? (v as? NSNumber).map { "\($0)" }
            guard let text, !text.isEmpty else { return nil }
            return ProfileEntry(id: k, label: k == "ageYears" ? "Age" : k.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).capitalized, value: text)
        }
    }

    func today() async throws -> TodaySummary {
        do { return try JSONDecoder().decode(TodaySummary.self, from: try await request("api/v1/log/today")) }
        catch let e as APIError { throw e } catch { throw APIError.server }
    }

    func supplementNames() async throws -> [String] {
        struct R: Decodable { struct S: Decodable { let name: String }; let supplements: [S] }
        do { return try JSONDecoder().decode(R.self, from: try await request("api/v1/log/supplements")).supplements.map(\.name) }
        catch let e as APIError { throw e } catch { throw APIError.server }
    }

    // A fresh id on every tap makes a retried request safe: the server never logs the same id twice.
    func log(_ event: [String: Any]) async throws -> Int {
        var body = event
        body["id"] = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let data = try await request("api/v1/events", method: "POST", body: try JSONSerialization.data(withJSONObject: body))
        struct R: Decodable { let id: Int }
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.server }
        return r.id
    }

    func options() async throws -> LogOptions { try await get("api/v1/log/options") }

    func history(limit: Int = 60) async throws -> [HistoryEntry] {
        struct R: Decodable { let entries: [HistoryEntry] }
        return (try await get("api/v1/log/history", [.init(name: "limit", value: String(limit))]) as R).entries
    }

    func deleteEntry(_ id: Int) async throws { _ = try await request("api/v1/events/\(id)", method: "DELETE") }
}
