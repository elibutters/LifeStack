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
        app.buttons["Connect"].tap()

        XCTAssertTrue(app.tabBars.buttons["Overview"].waitForExistence(timeout: 20), "should reach the home screen")
        // Every tab loads its screen from the server.
        for tab in ["Calendar", "Sleep", "Finance", "Log"] {
            let button = app.tabBars.buttons[tab]
            XCTAssertTrue(button.exists, "\(tab) tab")
            button.tap()
        }
        app.tabBars.buttons["Finance"].tap()
        XCTAssertTrue(app.staticTexts["Net worth"].waitForExistence(timeout: 20), "finance summary loads")
        app.tabBars.buttons["Sleep"].tap()
        XCTAssertTrue(app.staticTexts["Recent nights"].waitForExistence(timeout: 20), "sleep nights load")
        app.tabBars.buttons["Log"].tap()
        XCTAssertTrue(app.buttons["Coffee"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Overview"].tap()
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10), "the account sheet should open")
        XCTAssertTrue(app.staticTexts["Connections"].waitForExistence(timeout: 20), "connections load")
    }
}
