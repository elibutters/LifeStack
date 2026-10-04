import SwiftUI

// Set each supplement's dose once. It becomes the default for every day and updates today's entry if already taken.
struct DoseEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let supplements: [LogOptions.Supplement]
    @State private var text: [Int: String] = [:]
    @State private var unit: [Int: String] = [:]
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(supplements, id: \.id) { s in
                        HStack(spacing: 10) {
                            Text(s.name).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
                            Spacer(minLength: 6)
                            HStack(spacing: 4) {
                                TextField("Dose", text: binding(s)).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                    .accessibilityIdentifier("dose-\(s.name)")
                                if !(text[s.id] ?? "").isEmpty {
                                    Button { text[s.id] = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                                        .buttonStyle(.plain).accessibilityLabel("Clear \(s.name) dose")
                                }
                            }
                            .padding(.horizontal, 10).frame(width: 100, height: 38).glassEffect(.regular, in: .rect(cornerRadius: Theme.rs))
                            Picker("Unit", selection: unitBinding(s)) { Text("mg").tag("mg"); Text("g").tag("g") }.pickerStyle(.segmented).frame(width: 92)
                        }
                        .padding(.horizontal, 12).frame(minHeight: 52).glassEffect(.regular, in: .rect(cornerRadius: Theme.r))
                    }
                }
                .padding(14)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Ambient())
            .navigationTitle("Doses").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving) }
            }
        }
        .onAppear {
            for s in supplements {
                text[s.id] = s.dose.map { $0 == $0.rounded() ? String(Int($0)) : String($0) } ?? ""
                unit[s.id] = s.unit ?? "mg"
            }
        }
    }

    private func binding(_ s: LogOptions.Supplement) -> Binding<String> { Binding(get: { text[s.id] ?? "" }, set: { text[s.id] = $0 }) }
    private func unitBinding(_ s: LogOptions.Supplement) -> Binding<String> { Binding(get: { unit[s.id] ?? "mg" }, set: { unit[s.id] = $0 }) }

    private func save() async {
        saving = true; defer { saving = false }
        for s in supplements {
            let raw = (text[s.id] ?? "").trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
            let dose: Double? = raw.isEmpty ? nil : Double(raw)
            if !raw.isEmpty && dose == nil { continue }
            let u = unit[s.id] ?? "mg"
            if dose == s.dose && (dose == nil || u == (s.unit ?? "mg")) { continue }
            await model.setDose(s, dose: dose, unit: u)
        }
        await model.refresh()
        dismiss()
    }
}
