import SwiftUI

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if AppModel.bundledAddress == nil {
                        TextField("Address", text: $address, prompt: Text("your-app.vercel.app"))
                            .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    TextField("Email", text: $email)
                        .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(.password).textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: {
                    Text("The same email and password as the web app. You sign in once: the password is not kept, this iPhone gets its own key in the Keychain. Revoke the key any time on the web app's API keys page.")
                }
                if let message = model.message {
                    Section { Text(message).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task { await model.signIn(address: address, email: email, password: password) }
                    } label: {
                        HStack { Text("Connect"); if model.busy { Spacer(); ProgressView() } }
                    }
                    .disabled((AppModel.bundledAddress == nil && address.isEmpty) || email.isEmpty || password.isEmpty || model.busy)
                }
            }
            .navigationTitle("Life Stack")
            .onAppear { if address.isEmpty { address = model.address } }
        }
    }
}
