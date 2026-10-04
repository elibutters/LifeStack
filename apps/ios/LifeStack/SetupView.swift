import SwiftUI

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var key = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Address", text: $address, prompt: Text("your-app.vercel.app"))
                        .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("API key", text: $key, prompt: Text("ls_..."))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: {
                    Text("Create a key on the web app's API keys page with access to add and read today. It stays in this iPhone's Keychain.")
                }
                if let message = model.message {
                    Section { Text(message).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task { await model.signIn(address: address, key: key) }
                    } label: {
                        HStack { Text("Connect"); if model.busy { Spacer(); ProgressView() } }
                    }
                    .disabled(address.isEmpty || key.isEmpty || model.busy)
                }
            }
            .navigationTitle("Life Stack")
            .onAppear { if address.isEmpty { address = model.address } }
        }
    }
}
