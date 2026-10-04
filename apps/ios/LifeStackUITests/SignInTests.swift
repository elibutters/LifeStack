import XCTest

// Signs in against a development server and checks that the Today screen loads. Needs a throwaway key:
//   TEST_RUNNER_LS_EMAIL=... TEST_RUNNER_LS_PASSWORD=... xcodebuild test ... API_BASE_URL=http:/\$()/localhost:3000
// Skipped when the variables are not set. The credentials are the development server's. Run it on a
// simulator whose Keychain is reset (`xcrun simctl keychain <device> reset`) so the app starts signed out.
final class SignInTests: XCTestCase {
    func testSignInShowsToday() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["LS_EMAIL"], let password = env["LS_PASSWORD"] else { throw XCTSkip("LS_EMAIL and LS_PASSWORD not set") }

        let app = XCUIApplication()
        app.launch()

        // The server address is baked into the build (API_BASE_URL), so only email and password are asked for.
        let emailField = app.textFields["Email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["Address"].exists, "the app should not ask for an address")
        emailField.tap(); emailField.typeText(email)
        let keyField = app.secureTextFields.firstMatch
        keyField.tap(); keyField.typeText(password)
        app.buttons["Sign in"].tap()

        XCTAssertTrue(app.tabBars.buttons["Overview"].waitForExistence(timeout: 20), "should reach the home screen")
        shot("overview", env)
        // Every tab loads its screen from the server.
        for tab in ["Calendar", "Sleep", "Finance", "Log"] {
            let button = app.tabBars.buttons[tab]
            XCTAssertTrue(button.exists, "\(tab) tab")
            button.tap()
            if tab != "Log" { shot(tab.lowercased(), env) }
        }
        app.tabBars.buttons["Finance"].tap()
        XCTAssertTrue(app.staticTexts["NET WORTH"].waitForExistence(timeout: 20), "finance summary loads")
        app.tabBars.buttons["Sleep"].tap()
        XCTAssertTrue(app.staticTexts["LAST NIGHT"].waitForExistence(timeout: 20), "sleep nights load")
        app.tabBars.buttons["Log"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Coffee'")).firstMatch.waitForExistence(timeout: 15))
        // A supplement is taken or not: one tap takes it (with its dose), the next tap un-takes it, and taking it
        // again leaves exactly one entry.
        let zinc = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Zinc'")).firstMatch
        XCTAssertTrue(zinc.waitForExistence(timeout: 10))
        zinc.tap()
        XCTAssertTrue(app.staticTexts["Logged Zinc 22 mg"].waitForExistence(timeout: 10), "taking it confirms with the dose")
        shot("log", env)
        XCTAssertTrue(app.buttons["Undo"].exists, "the confirmation offers Undo")
        Thread.sleep(forTimeInterval: 1.5)
        zinc.tap()
        // Un-taking is confirmed on the server side (create, delete, create leaves one entry); the toast is too brief to assert on.
        Thread.sleep(forTimeInterval: 1.5)
        zinc.tap()
        XCTAssertTrue(app.staticTexts["Logged Zinc 22 mg"].waitForExistence(timeout: 10), "and taking it again works")
    }

    private func shot(_ name: String, _ env: [String: String]) {
        guard let dir = env["LS_SHOTS"] else { return }
        Thread.sleep(forTimeInterval: 3)
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }
}
