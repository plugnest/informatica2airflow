import * as vscode from 'vscode';

import { ConnectionCreds, Connection, SupportedDatabase } from './Connection';

export function activate(context: vscode.ExtensionContext) {
	const connectionAdder = vscode.commands.registerCommand('informatica2airflow.addconnection', async () => {
		const creds = new ConnectionCreds(process.env.DB_USERNAME as string, process.env.DB_PASSWORD as string, process.env.DB_CONN_URL as string);
		const dbConnection = new Connection(SupportedDatabase.Oracle, creds);

		let connection;
		try {
			connection = await dbConnection.getConnection();

		} catch (err) {
			console.error(err);
		} finally {
			if (connection) {
				await dbConnection.closeConnection(connection);
			}
		}
		vscode.window.showInformationMessage('Hello World from informatica2airflow!');
	});

	context.subscriptions.push(connectionAdder);
}

export function deactivate() { }
