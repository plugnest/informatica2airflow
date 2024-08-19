import * as assert from "assert";
import * as vscode from "vscode";
import { Connection, ConnectionCreds, SupportedDatabase } from "../Connection";
import { WORKFLOW_SESSION_INSTANCES } from "../queries";

suite("Query and Sort The Result", async function () {
  vscode.window.showInformationMessage("Start all tests.");

  this.timeout(10000);

  test("TopSort", async () => {});
});
