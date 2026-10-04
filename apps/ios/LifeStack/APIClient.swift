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
    case badAddress, unauthorized, needsReadAccess, offline, server

    var errorDescription: String? {
        switch self {
        case .badAddress: "That address does not look right. Use the https address of your deployment."
        case .unauthorized: "The key was not accepted. Check it was copied in full and has not been revoked."
        case .needsReadAccess: "This key can only add logs. Make one with read access too."
        case .offline: "Could not reach the server. Check your connection."
        case .server: "The server had a problem. Try again shortly."
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

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var req = URLRequest(url: base.appending(path: path), timeoutInterval: 15)
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
    func log(_ event: [String: Any]) async throws {
        var body = event
        body["id"] = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        _ = try await request("api/v1/events", method: "POST", body: try JSONSerialization.data(withJSONObject: body))
    }
}
