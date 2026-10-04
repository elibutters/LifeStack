import XCTest

// Signs in against a development server and checks that the Today screen loads. Needs a throwaway key:
//   TEST_RUNNER_LS_ADDRESS=http://localhost:3000 TEST_RUNNER_LS_KEY=ls_... xcodebuild test ...
// Skipped when the variables are not set. The key must allow log read. Run it on a simulator whose
// Keychain is reset (`xcrun simctl keychain <device> reset`) so the app starts signed out.
final class SignInTests: XCTestCase {
    func testSignInShowsToday() throws {
        let env = ProcessInfo.processInfo.environment
        guard let address = env["LS_ADDRESS"], let key = env["LS_KEY"] else { throw XCTSkip("LS_ADDRESS and LS_KEY not set") }

        let app = XCUIApplication()
        app.launch()

        let addressField = app.textFields.firstMatch
        XCTAssertTrue(addressField.waitForExistence(timeout: 10))
        addressField.tap(); addressField.typeText(address)
        let keyField = app.secureTextFields.firstMatch
        keyField.tap(); keyField.typeText(key)
        app.buttons["Connect"].tap()

        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 15), "should reach the Today screen")
        XCTAssertTrue(app.staticTexts["Caffeine"].waitForExistence(timeout: 15), "the summary should load")
        XCTAssertTrue(app.buttons["Coffee"].exists)
    }
}
