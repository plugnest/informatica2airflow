import * as dotenv from "dotenv";
import * as vscode from "vscode";
import { ConnectionCreds, Connection, SupportedDatabase } from "./Connection";
import { SubjectAreaProvider, SubjectArea } from "./SubjectAreaProvider";
import {
  ConnectionNode,
  ConnectionsProvider,
  ConnectionView,
} from "./ConnectionsProvider";
import {
  COMMANDS,
  EVENT_WAIT_FILE,
  INSTANCES,
  INSTANCES_BAK,
  SUB_WF,
  WORKFLOW_SESSION_INSTANCES,
} from "./queries";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TaskNode, topoSort } from "./sorter";
import { DAGBuilder } from "./dag_builder";

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

const genAI = new GoogleGenerativeAI(process.env.API_KEY as string);

const model = genAI.getGenerativeModel({ model: process.env.MODEL as string });

interface ClickedItem {
  label: string;
  parentName: string;
}

interface Folder {
  name: string;
  workflows: Workflow[];
}

interface Workflow {
  name: string;
}

const taskTypeToOperator: { [key: string]: string } = {
  "Event Wait": "DummyOperator",
  Start: "BashOperator",
  Session: "PythonOperator",
  Command: "BashOperator",
};

let newConnection: ConnectionView;

export function activate(context: vscode.ExtensionContext) {
  const subjectAreaProvider = new SubjectAreaProvider([]);
  const connectionsProvider = new ConnectionsProvider(context);

  vscode.window.registerTreeDataProvider("subjectAreas", subjectAreaProvider);
  vscode.window.registerTreeDataProvider("connections", connectionsProvider);

  const connectionAdder = vscode.commands.registerCommand(
    "informatica2airflow.addconnection",
    async () => {
      const username = await vscode.window.showInputBox({
        prompt: "Enter username for Oracle connection",
        placeHolder: "Username",
        ignoreFocusOut: true,
      });
      if (!username) {
        return;
      }

      const password = await vscode.window.showInputBox({
        prompt: "Enter password for Oracle connection",
        placeHolder: "Password",
        password: true,
        ignoreFocusOut: true,
      });
      if (!password) {
        return;
      }

      const connectionString = await vscode.window.showInputBox({
        prompt:
          "Enter connection string for Oracle connection (e.g., host:port/servicename)",
        placeHolder: "Connection String",
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
        newConnection = new ConnectionView(
          username,
          password,
          connectionString
        );
        connectionsProvider.addConnection(newConnection);

        const result = await connection.execute<any>(SUB_WF);

        const folders: { [folderName: string]: Folder } = {};

        result?.rows?.forEach((row) => {
          const folderName = row[0];
          const workflowName = row[1];

          if (!folders[folderName]) {
            folders[folderName] = { name: folderName, workflows: [] };
          }

          folders[folderName].workflows.push({ name: workflowName });
        });

        const subjectAreas = Object.keys(folders).map((folderName) => {
          const folder = folders[folderName];
          const workflows = folder.workflows.map(
            (workflow) =>
              new SubjectArea(
                workflow.name,
                vscode.TreeItemCollapsibleState.None,
                [],
                {
                  command: "informatica2airflow.generateDAGFile",
                  title: "Open",
                  arguments: [folder.name, workflow.name],
                },
                "workflow",
                folder.name
              )
          );
          return new SubjectArea(
            folder.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            workflows
          );
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
    }
  );

  const dagGenerator = vscode.commands.registerCommand(
    "informatica2airflow.generateDAGFile",
    async (selectedItem: ClickedItem) => {
      const workflowName = selectedItem.label;
      const subjectAreaName = selectedItem.parentName;

      let { username, password, connectionString } = newConnection;
      const creds = new ConnectionCreds(username, password, connectionString);
      const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
      let connection;
      try {
        connection = await dbConnection.getConnection();

        const result = await connection.execute<any>(
          WORKFLOW_SESSION_INSTANCES,
          {
            workflowName: workflowName,
            subjectAreaName: subjectAreaName,
          }
        );

        const taskNodes: undefined | TaskNode[] = result.rows?.map((row) => ({
          fromInstId: row[0],
          toInstId: row[1],
          conditionId: row[2],
          condition: row[3],
          fromTaskId: row[4],
          fromInstName: row[5],
          fromInstTaskType: row[6],
          fromInstTaskTypeName: row[7],
          toTaskId: row[8],
          toInstName: row[9],
          toInstTaskType: row[10],
          toInstTaskTypeName: row[11],
        }));

        if (taskNodes === undefined) {
          // TODO: Try to use the query from task inst run
          return;
        }
        const sortedTasks = topoSort(taskNodes as TaskNode[]);

        if (typeof sortedTasks === "string") {
          console.error(sortedTasks);
          return;
          // TODO: Try to use the query from task inst run
        } else {
          console.log("Sorted tasks:", sortedTasks);
        }

        const dagCode = await generateDAGCodeFromTasks(
          sortedTasks,
          workflowName,
          subjectAreaName
        );

        const document = await vscode.workspace.openTextDocument({
          content: dagCode,
          language: "python",
        });
        await vscode.window.showTextDocument(document);
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage("Error executing query");
      } finally {
        if (connection) {
          await dbConnection.closeConnection(connection);
        }
      }
    }
  );

  const openConnection = vscode.commands.registerCommand(
    "informatica2airflow.openConnection",
    async (connectionView: ConnectionNode) => {
      // vscode.window.showInformationMessage(`Opening connection for ${connectionView.connection.username}@${connectionView.connection.connectionString}`);
      const { username, password, connectionString } =
        connectionView.connection;
      newConnection = new ConnectionView(username, password, connectionString);
      const creds = new ConnectionCreds(username, password, connectionString);
      const dbConnection = new Connection(SupportedDatabase.Oracle, creds);

      let connection;
      try {
        connection = await dbConnection.getConnection();

        const result = await connection.execute<any>(SUB_WF);

        const folders: { [folderName: string]: Folder } = {};

        result?.rows?.forEach((row) => {
          const folderName = row[0];
          const workflowName = row[1];

          if (!folders[folderName]) {
            folders[folderName] = { name: folderName, workflows: [] };
          }

          folders[folderName].workflows.push({ name: workflowName });
        });

        const subjectAreas = Object.keys(folders).map((folderName) => {
          const folder = folders[folderName];
          const workflows = folder.workflows.map(
            (workflow) =>
              new SubjectArea(
                workflow.name,
                vscode.TreeItemCollapsibleState.None,
                [],
                {
                  command: "informatica2airflow.generateDAGFile",
                  title: "Open",
                  arguments: [folder.name, workflow.name],
                },
                "workflow",
                folder.name
              )
          );
          return new SubjectArea(
            folder.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            workflows
          );
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
    }
  );
  context.subscriptions.push(connectionAdder, dagGenerator, openConnection);
}

const generateDAGCodeFromTasks = async (
  tasks: TaskNode[],
  workflowName: string,
  subjectAreaName: string
) => {
  let builder = new DAGBuilder()
    .setDagId("recharge_dag")
    .setDefaultArgs({
      owner: "",
      email: [`${process.env.EMAIL_ADDRESS}`],
      email_on_failure: "False",
      email_on_retry: "False",
    })
    .addTag(workflowName.split("_")[1])
    .addImport(
      "from banglalink.airflow.callbacks import on_failure_callback, on_success_callback"
    )
    .setCallbacks("on_success_callback", "on_failure_callback")
    .setMaxActiveRuns(1)
    .setCatchup("False")
    .setParams({
      date_value:
        "pendulum.today('Asia/Dhaka').add(days=0).strftime('%Y-%m-%d')",
    });

  const start = tasks[0]!;
  builder.addTask(
    start.fromInstName.toLocaleLowerCase(),
    start.fromInstTaskTypeName.toLocaleLowerCase(),
    "print('Started')"
  );

  const processed: Map<string, boolean> = new Map();
  await Promise.all(
    tasks.map(async (task) => {
      if (processed.get(task.toInstName)) {
        builder.addDependency(
          task.fromInstName.toLocaleLowerCase(),
          task.toInstName.toLocaleLowerCase()
        );
        return;
      }
      processed.set(task.toInstName, true);
      switch (task.toInstTaskTypeName.toLocaleLowerCase()) {
        case "event wait":
          const fileName = await getEventWaitFileName(
            workflowName,
            task.toInstName,
            subjectAreaName
          );
          builder
            .addTask(
              task.toInstName.toLocaleLowerCase(),
              task.toInstTaskTypeName.toLocaleLowerCase(),
              "",
              "",
              fileName
            )
            .addDependency(
              task.fromInstName.toLocaleLowerCase(),
              task.toInstName.toLocaleLowerCase()
            );
          break;
        case "command":
          const commandsInfo = await getCommands(
            workflowName,
            task.toInstName,
            subjectAreaName
          );
          const commands = commandsInfo.map(
            (command: Array<string>) => command[0]
          );
          builder
            .addTask(
              task.toInstName.toLocaleLowerCase(),
              task.toInstTaskTypeName.toLocaleLowerCase(),
              "",
              `${commands.join(" && \\\n\t\t\t")}`
            )
            .addDependency(
              task.fromInstName.toLocaleLowerCase(),
              task.toInstName.toLocaleLowerCase()
            );
          break;
        case "decision":
          builder
            .addImport("from airflow.operators.empty import EmptyOperator")
            .addTask(
              task.toInstName.toLocaleLowerCase(),
              task.toInstTaskTypeName.toLocaleLowerCase(),
              "",
              "",
              "",
              `${task.condition}`,
              "",
              "",
              "EmptyOperator"
            )
            .addDependency(
              task.fromInstName.toLocaleLowerCase(),
              task.toInstName.toLocaleLowerCase()
            );
          break;
        default:
          builder
            .addImport("from airflow.operators.empty import EmptyOperator")
            .addTask(
              task.toInstName.toLocaleLowerCase(),
              task.toInstTaskTypeName.toLocaleLowerCase(),
              "",
              "",
              "",
              "",
              "",
              "",
              "EmptyOperator"
            )
            .addDependency(
              task.fromInstName.toLocaleLowerCase(),
              task.toInstName.toLocaleLowerCase()
            );
          break;
      }
      return;
    })
  );

  return builder.build();
};

const getEventWaitFileName = async (
  workflowName: string,
  taskName: string,
  subjectAreaName: string
): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(EVENT_WAIT_FILE, {
      workflowName: workflowName,
      taskName: taskName,
      subjectAreaName: subjectAreaName,
    });

    console.log(result);
    return result?.rows || [];
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage("Error executing query");
  } finally {
    if (connection) {
      await dbConnection.closeConnection(connection);
    }
  }
};

const getCommands = async (
  workflowName: string,
  taskName: string,
  subjectAreaName: string
): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(COMMANDS, {
      workflowName: workflowName,
      taskName: taskName,
      subjectAreaName: subjectAreaName,
    });

    console.log(result);
    return result?.rows || [];
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage("Error executing query");
  } finally {
    if (connection) {
      await dbConnection.closeConnection(connection);
    }
  }
};

async function FormatDependenciesByAI(prompt: string) {
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();
  console.log(text);
  return text;
}

export function deactivate() {}
