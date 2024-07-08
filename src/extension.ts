import * as vscode from 'vscode';
import { ConnectionCreds, Connection, SupportedDatabase } from './Connection';
import { SubjectAreaProvider, SubjectArea } from './SubjectAreaProvider';
import { ConnectionsProvider, ConnectionView } from './ConnectionsProvider';
import { SUB_WF } from './queries';

interface Folder {
	name: string;
	mappings: Mapping[];
}

interface Mapping {
	name: string;
}

export function activate(context: vscode.ExtensionContext) {
	const subjectAreaProvider = new SubjectAreaProvider([]);
	const connectionsProvider = new ConnectionsProvider(context);

	vscode.window.registerTreeDataProvider('subject-areas', subjectAreaProvider);
	vscode.window.registerTreeDataProvider('connections', connectionsProvider);

	const connectionAdder = vscode.commands.registerCommand('informatica2airflow.addconnection', async () => {
		const username = await vscode.window.showInputBox({
			prompt: 'Enter username for Oracle connection',
			placeHolder: 'Username',
			ignoreFocusOut: true,
		});
		if (!username) {
			return;
		}

		const password = await vscode.window.showInputBox({
			prompt: 'Enter password for Oracle connection',
			placeHolder: 'Password',
			password: true,
			ignoreFocusOut: true,
		});
		if (!password) {
			return;
		}

		const connectionString = await vscode.window.showInputBox({
			prompt: 'Enter connection string for Oracle connection (e.g., host:port/servicename)',
			placeHolder: 'Connection String',
			ignoreFocusOut: true,
		});
		if (!connectionString) {
			return;
		}

		const creds = new ConnectionCreds(username, password, connectionString);
		const dbConnection = new Connection(SupportedDatabase.Oracle, creds);

		let connection;
		try {
			connection = await dbConnection.getConnection();
			const newConnection = new ConnectionView(username, password, connectionString);
            connectionsProvider.addConnection(newConnection);

			const result = await connection.execute<any>(SUB_WF);

			const folders: { [folderName: string]: Folder } = {};

			result?.rows?.forEach(row => {
				const folderName = row[0];
				const mappingName = row[1];

				if (!folders[folderName]) {
					folders[folderName] = { name: folderName, mappings: [] };
				}

				folders[folderName].mappings.push({ name: mappingName });
			});

			const subjectAreas = Object.keys(folders).map(folderName => {
				const folder = folders[folderName];
				const mappings = folder.mappings.map(mapping => new SubjectArea(mapping.name, vscode.TreeItemCollapsibleState.None));
				return new SubjectArea(folder.name, vscode.TreeItemCollapsibleState.Collapsed, mappings);
			});

			subjectAreaProvider.subjectAreas = subjectAreas;
			subjectAreaProvider.refresh();
		} catch (err) {
			console.error(err);
		} finally {
			if (connection) {
				await dbConnection.closeConnection(connection);
			}
		}

		vscode.window.showInformationMessage('Connection added and subject areas loaded!');
	});

	context.subscriptions.push(connectionAdder);
}

export function deactivate() { }
