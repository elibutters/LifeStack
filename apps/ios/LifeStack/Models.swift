import Foundation

// Shapes returned by /api/v1. Fields the app can live without are optional, so one missing value never
// blanks a whole screen.
struct CalendarItem: Decodable, Identifiable, Equatable {
    let id: Int
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let kind: String
    let location: String?
}

struct Night: Decodable, Identifiable, Equatable {
    var id: String { day }
    let day: String
    let score: Double?
    let sleepMin: Double?
    let deepMin: Double?
    let remMin: Double?
    let lightMin: Double?
    let awakeMin: Double?
    let hrv: Double?
    let respiratoryAvg: Double?
}

struct NetWorth: Decodable, Equatable { let assets: Double; let liabilities: Double; let net: Double }
struct MonthSummary: Decodable, Equatable {
    struct Category: Decodable, Equatable, Identifiable { var id: String { label }; let label: String; let amount: Double; let count: Int }
    let month: String
    let income: Double
    let spending: Double
    let net: Double
    let byCategory: [Category]?
}
struct Insight: Decodable, Equatable, Identifiable { let id: String; let tone: String; let title: String; let detail: String }

struct FinanceSummary: Decodable, Equatable {
    struct Account: Decodable, Equatable, Identifiable {
        var id: String { "\(institution ?? "")-\(name)" }
        let name: String
        let institution: String?
        let subtype: String?
        let balance: Double?
    }
    struct Group: Decodable, Equatable, Identifiable { var id: String { key }; let key: String; let label: String; let total: Double; let accounts: [Account] }
    struct Flow: Decodable, Equatable, Identifiable { var id: String { month }; let month: String; let income: Double; let spending: Double }
    let netWorth: NetWorth
    let groups: [Group]
    let thisMonth: MonthSummary
    let lastMonth: MonthSummary
    let cashflow: [Flow]
    let insights: [Insight]
}

struct Transaction: Decodable, Equatable, Identifiable {
    var id: String { "\(date)-\(merchant)-\(amount)" }
    let date: String
    let merchant: String
    let amount: Double
    let category: String?
    let kind: String
    let pending: Bool
}

struct Holding: Decodable, Equatable, Identifiable {
    var id: String { "\(symbol ?? name ?? "")-\(quantity)" }
    let symbol: String?
    let name: String?
    let quantity: Double
    let price: Double
    let value: Double
    let costBasis: Double?
}

struct Overview: Decodable, Equatable {
    struct Calendar: Decodable, Equatable { let today: [CalendarItem]; let soon: [CalendarItem]; let failed: Bool; let connected: Bool }
    struct Sleep: Decodable, Equatable { let connected: Bool; let lastNight: Night? }
    struct Finance: Decodable, Equatable {
        struct Month: Decodable, Equatable { let income: Double; let spending: Double; let net: Double }
        let netWorth: NetWorth
        let thisMonth: Month
        let insights: [Insight]
    }
    let date: String
    let calendar: Calendar?
    let sleep: Sleep?
    let finance: Finance?
    let log: TodaySummary?
}

struct ConnectionsStatus: Decodable, Equatable {
    struct Source: Decodable, Equatable { let provider: String; let connected: Bool; let syncedAt: String? }
    struct Bank: Decodable, Equatable, Identifiable { var id: String { institution }; let institution: String; let kind: String; let status: String; let error: String?; let syncedAt: String? }
    let calendar: Source
    let sleep: Source
    let banks: [Bank]
}

// The profile is a flat object of text and numbers; the app shows whatever is filled in.
struct ProfileEntry: Identifiable, Equatable { let id: String; let label: String; let value: String }

struct HistoryEntry: Decodable, Equatable, Identifiable {
    let id: Int
    let at: String
    let key: String
    let label: String
    let source: String
    let name: String?
    let dose: Double?
    let unit: String?
}

// What the quick log offers, with default amounts, as the server defines it.
struct LogOptions: Decodable, Equatable {
    struct Supplement: Decodable, Equatable, Hashable { let id: Int; let name: String; let dose: Double?; let unit: String? }
    struct Drink: Decodable, Equatable, Hashable { let drink: String; let mg: Double }
    let supplements: [Supplement]
    let caffeine: [Drink]
}

extension LogOptions.Supplement {
    var doseText: String? {
        guard let dose, let unit else { return nil }
        return "\(dose == dose.rounded() ? String(Int(dose)) : String(dose)) \(unit)"
    }
}

enum Format {
    static func money(_ v: Double, cents: Bool = false) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency; f.currencyCode = "USD"
        f.maximumFractionDigits = cents ? 2 : 0; f.minimumFractionDigits = cents ? 2 : 0
        return f.string(from: NSNumber(value: v)) ?? "$\(Int(v))"
    }
    static func minutes(_ m: Double?) -> String {
        guard let m else { return "-" }
        let t = Int(m.rounded())
        return t >= 60 ? "\(t / 60)h \(t % 60)m" : "\(t)m"
    }
    private static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let isoPlain = ISO8601DateFormatter()
    static func date(_ s: String) -> Date? { iso.date(from: s) ?? isoPlain.date(from: s) }
    static func dayDate(_ s: String) -> Date? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        return f.date(from: s)
    }
    static func time(_ item: CalendarItem) -> String {
        if item.allDay { return "All day" }
        guard let d = date(item.start) else { return "" }
        return d.formatted(date: .omitted, time: .shortened)
    }
    static func dayHeading(_ item: CalendarItem) -> String {
        let d = item.allDay ? dayDate(String(item.start.prefix(10))) : date(item.start)
        return d?.formatted(.dateTime.weekday(.wide).month().day()) ?? item.start
    }
    static func dayKey(_ item: CalendarItem) -> String {
        item.allDay ? String(item.start.prefix(10)) : (date(item.start).map { $0.formatted(.iso8601.year().month().day()) } ?? item.start)
    }
    static func clock(_ iso: String) -> String { date(iso)?.formatted(date: .omitted, time: .shortened) ?? "" }
    static func monthShort(_ ym: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.timeZone = .current
        return f.date(from: ym)?.formatted(.dateTime.month(.abbreviated)) ?? ym
    }
    static func longDay(_ d: Date) -> String { d.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()) }
    static func isToday(_ iso: String) -> Bool { date(iso).map { Calendar.current.isDateInToday($0) } ?? false }
    static func shortDay(_ s: String) -> String { dayDate(s)?.formatted(.dateTime.weekday(.abbreviated).month().day()) ?? s }
}
