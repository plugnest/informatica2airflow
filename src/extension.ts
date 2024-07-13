import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import { ConnectionCreds, Connection, SupportedDatabase } from './Connection';
import { SubjectAreaProvider, SubjectArea } from './SubjectAreaProvider';
import { ConnectionNode, ConnectionsProvider, ConnectionView } from './ConnectionsProvider';
import { INSTANCES, INSTANCES_BAK, SUB_WF } from './queries';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const genAI = new GoogleGenerativeAI(process.env.API_KEY as string);

const model = genAI.getGenerativeModel({ model: process.env.MODEL as string });

interface ClickedItem {
	label: string;
	parentName: string;
};

interface Folder {
	name: string;
	workflows: Workflow[];
}

interface Workflow {
	name: string;
}

const taskTypeToOperator: { [key: string]: string } = {
	"Event Wait": "DummyOperator",
	"Start": "BashOperator",
	"Session": "PythonOperator",
	"Command": "BashOperator"
};

let newConnection: ConnectionView;

export function activate(context: vscode.ExtensionContext) {
	const subjectAreaProvider = new SubjectAreaProvider([]);
	const connectionsProvider = new ConnectionsProvider(context);

	vscode.window.registerTreeDataProvider('subjectAreas', subjectAreaProvider);
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
			newConnection = new ConnectionView(username, password, connectionString);
			connectionsProvider.addConnection(newConnection);

			const result = await connection.execute<any>(SUB_WF);

			const folders: { [folderName: string]: Folder } = {};

			result?.rows?.forEach(row => {
				const folderName = row[0];
				const workflowName = row[1];

				if (!folders[folderName]) {
					folders[folderName] = { name: folderName, workflows: [] };
				}

				folders[folderName].workflows.push({ name: workflowName });
			});

			const subjectAreas = Object.keys(folders).map(folderName => {
				const folder = folders[folderName];
				const workflows = folder.workflows.map(workflow =>
					new SubjectArea(workflow.name, vscode.TreeItemCollapsibleState.None, [], {
						command: 'informatica2airflow.generateDAGFile',
						title: 'Open',
						arguments: [folder.name, workflow.name]
					}, 'workflow', folder.name)
				);
				return new SubjectArea(folder.name, vscode.TreeItemCollapsibleState.Collapsed, workflows);
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
	});

	const dagGenerator = vscode.commands.registerCommand('informatica2airflow.generateDAGFile', async (selectedItem: ClickedItem) => {
		const workflowName = selectedItem.label;
		const subjectAreaName = selectedItem.parentName;

		let { username, password, connectionString } = newConnection;
		const creds = new ConnectionCreds(username, password, connectionString);
		const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
		let connection;
		try {
			connection = await dbConnection.getConnection();

			const result = await connection.execute<any>(INSTANCES, {
				workflowName: workflowName,
				subjectAreaName: subjectAreaName
			});

			const tasks = result?.rows?.map(row => {
				const taskTypeName = row[0] as string;
				const taskName = row[1] as string;
				const operator = taskTypeToOperator[taskTypeName];
				if (operator) {
					return { taskName, operator };
				} else {
					console.warn(`No operator found for task type: ${taskTypeName}`);
					return null;
				}
			}).filter(task => task !== null);

			const dagCode = generateDAGCode(tasks as { taskName: string, operator: string }[]);

			// let aiGenerated = await generateDAGCodeWithAI("add the dependency flow here, please give the python code only for .py file, please don't include any explanation or suggestions, just the content of the python file: " + dagCode);
			// aiGenerated = aiGenerated.split('\n').slice(1, -1).join('\n');

			// const aiGeneratedDocument = await vscode.workspace.openTextDocument({
			// 	content: aiGenerated,
			// 	language: 'python'
			// });
			// await vscode.window.showTextDocument(aiGeneratedDocument);

			const document = await vscode.workspace.openTextDocument({
				content: dagCode,
				language: 'python'
			});
			await vscode.window.showTextDocument(document);
		} catch (err) {
			console.error(err);
			vscode.window.showErrorMessage('Error executing query');
		} finally {
			if (connection) {
				await dbConnection.closeConnection(connection);
			}
		}
	});

	const openConnection = vscode.commands.registerCommand('informatica2airflow.openConnection', async (connectionView: ConnectionNode) => {
		// vscode.window.showInformationMessage(`Opening connection for ${connectionView.connection.username}@${connectionView.connection.connectionString}`);
		const { username, password, connectionString } = connectionView.connection;
		newConnection = new ConnectionView(username, password, connectionString);
		const creds = new ConnectionCreds(username, password, connectionString);
		const dbConnection = new Connection(SupportedDatabase.Oracle, creds);

		let connection;
		try {
			connection = await dbConnection.getConnection();

			const result = await connection.execute<any>(SUB_WF);

			const folders: { [folderName: string]: Folder } = {};

			result?.rows?.forEach(row => {
				const folderName = row[0];
				const workflowName = row[1];

				if (!folders[folderName]) {
					folders[folderName] = { name: folderName, workflows: [] };
				}

				folders[folderName].workflows.push({ name: workflowName });
			});

			const subjectAreas = Object.keys(folders).map(folderName => {
				const folder = folders[folderName];
				const workflows = folder.workflows.map(workflow =>
					new SubjectArea(workflow.name, vscode.TreeItemCollapsibleState.None, [], {
						command: 'informatica2airflow.generateDAGFile',
						title: 'Open',
						arguments: [folder.name, workflow.name]
					}, 'workflow', folder.name)
				);
				return new SubjectArea(folder.name, vscode.TreeItemCollapsibleState.Collapsed, workflows);
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
	});
	context.subscriptions.push(connectionAdder, dagGenerator, openConnection);
}

function generateDAGCode(tasks: { taskName: string, operator: string }[]): string {
	const dagTemplate = `
from airflow import DAG
from airflow.operators.dummy_operator import DummyOperator
from airflow.operators.bash_operator import BashOperator
from airflow.operators.python_operator import PythonOperator
from datetime import datetime

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': datetime(2024, 1, 1),
    'retries': 1,
}

dag = DAG(
    'generated_dag',
    default_args=default_args,
    description='A DAG generated from Informatica tasks',
    schedule_interval='@daily',
)

`;

	const taskDefinitions = tasks.map(task => {
		return `
${task.taskName.replace(/\s+/g, '_').toLowerCase()} = ${task.operator}(
    task_id='${task.taskName.replace(/\s+/g, '_').toLowerCase()}',
    dag=dag,
    # Add operator-specific arguments here
)
`;
	}).join('\n');

	// const taskDependencies = tasks.map(task => task.taskName.replace(/\s+/g, '_').toLowerCase()).join(' >> ');

	return dagTemplate + taskDefinitions + '\n'; // + taskDependencies + '\n';
}

async function generateDAGCodeWithAI(prompt: string) {
	const result = await model.generateContent(prompt);
	const response = await result.response;
	const text = response.text();
	console.log(text);
	return text;
}

export function deactivate() { }
