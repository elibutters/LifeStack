import SwiftUI

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?
    private enum Field { case address, email, password }

    private let accent = LinearGradient(colors: [Color(red: 0.30, green: 0.44, blue: 1.0), Color(red: 0.56, green: 0.48, blue: 0.94)], startPoint: .topLeading, endPoint: .bottomTrailing)
    private var ready: Bool { (AppModel.bundledAddress != nil || !address.isEmpty) && !email.isEmpty && !password.isEmpty && !model.busy }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Image("Logo").resizable().scaledToFit().frame(width: 96).padding(.top, 72)
                Text("Life Stack").font(.largeTitle.weight(.semibold)).padding(.bottom, 20)

                if AppModel.bundledAddress == nil {
                    field(TextField("Address", text: $address, prompt: Text("your-app.vercel.app")).textContentType(.URL).keyboardType(.URL))
                        .focused($focus, equals: .address)
                }
                field(TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress))
                    .focused($focus, equals: .email)
                field(SecureField("Password", text: $password).textContentType(.password))
                    .focused($focus, equals: .password)
                    .onSubmit { submit() }

                if let message = model.message {
                    Text(message).font(.subheadline).foregroundStyle(.red).multilineTextAlignment(.center).padding(.top, 2)
                }

                Button(action: submit) {
                    HStack(spacing: 8) {
                        if model.busy { ProgressView().tint(.white) }
                        Text("Sign in").font(.headline)
                    }
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .foregroundStyle(.white)
                    .background(accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .opacity(ready ? 1 : 0.45)
                }
                .disabled(!ready)
                .padding(.top, 8)
            }
            .padding(.horizontal, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.black.ignoresSafeArea())
        .onAppear { if address.isEmpty { address = model.address } }
    }

    private func field<F: View>(_ view: F) -> some View {
        view
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(.horizontal, 16).frame(height: 54)
            .background(Color.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func submit() {
        guard ready else { return }
        focus = nil
        Task { await model.signIn(address: address, email: email, password: password) }
    }
}
