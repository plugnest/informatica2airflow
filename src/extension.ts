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
  SESSION_CONNECTION,
  SESSION_FILE_VALS,
  SESSION_WIDGET,
  SESSION_WIDGET_ATTRIBUTES,
  SESSION_WRITERS_READERS,
  SUB_WF,
  WIDGET_SOURCE_FILED,
  WIDGET_TARGET_FILED,
  WORKFLOW_SESSION_INSTANCES,
} from "./queries";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TaskNode, topoSort } from "./sorter";
import { DAGBuilder } from "./dagBuilder";

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

interface SessionWidgetInfo {
  SESSION_ID: number;
  SESS_WIDG_INST_ID: number;
  WIDGET_ID: number;
  WIDGET_TYPE: number;
  INSTANCE_ID: number;
  INSTANCE_NAME: string;
  WIDGET_TYPE_NAME: string;
}

interface SessionConnectionInfo {
  SESSION_ID: number;
  SESS_WIDG_INST_ID: number;
  REF_OBJECT_ID: number;
  REF_OBJECT_TYPE: number;
  REF_OBJECT_SUBTYP: number;
  OBJECT_NAME: string;
  USER_NAME: string;
  ATTR_ID: number;
  ATTR_VALUE: string;
}

interface WritersReadersInfo {
  SESSION_ID: number;
  SESS_WIDG_INST_ID: number;
  OBJECT_TYPE: number;
  OBJECT_SUBTYPE: number;
  OBJECT_NAME: string;
}

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
          fromInstMappingName: row[12],
          fromInstMappingId: row[13],
          toInstMappingId: row[14],
          toInstMappingName: row[15],
        }));

        if (taskNodes === undefined) {
          // TODO: Try to use the query from task inst run
          return;
        }
        const sortedTasks = topoSort(taskNodes!);

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
    .setDagId(workflowName.toLocaleLowerCase().replace("wf_", ""))
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

  for (const task of tasks) {
    if (processed.get(task.toInstName)) {
      builder.addDependency(
        task.fromInstName.toLocaleLowerCase(),
        task.toInstName.toLocaleLowerCase()
      );
      continue;
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
          .addImport("from airflow.sensors.filesystem import FileSensor")
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
        const candidate_tasks = tasks.filter(
          (cnddt) => cnddt.fromInstId === task.toInstId
        );
        builder
          .addTask(
            task.toInstName.toLocaleLowerCase(),
            task.toInstTaskTypeName.toLocaleLowerCase(),
            "",
            "",
            "",
            `${candidate_tasks[0].condition}`,
            `${candidate_tasks[0].toInstName.toLocaleLowerCase()}`,
            `${candidate_tasks[1].toInstName.toLocaleLowerCase()}`,
            ""
          )
          .addDependency(
            task.fromInstName.toLocaleLowerCase(),
            task.toInstName.toLocaleLowerCase()
          );
        break;
      case "session":
        const [
          sessionWidgetInfoRaw,
          sessionConnectionInfoRaw,
          writersReadersInfoRaw,
        ]: [
          SessionWidgetInfo[],
          SessionConnectionInfo[],
          WritersReadersInfo[]
        ] = await Promise.all([
          getSessionWidgetInfo(task.toTaskId),
          getSessionConnectionInfo(task.toTaskId),
          getWritersReadersInfo(task.toTaskId),
        ]);

        const sessionWidgetInfo: SessionWidgetInfo[] = sessionWidgetInfoRaw.map(
          (item: any) => ({
            SESSION_ID: item[0] ?? 0,
            SESS_WIDG_INST_ID: item[1] ?? 0,
            WIDGET_ID: item[2] ?? 0,
            WIDGET_TYPE: item[3] ?? 0,
            INSTANCE_ID: item[4] ?? 0,
            INSTANCE_NAME: item[5] ?? "",
            WIDGET_TYPE_NAME: item[6] ?? "",
          })
        );

        const sessionConnectionInfo: SessionConnectionInfo[] =
          sessionConnectionInfoRaw.map((item: any) => ({
            SESSION_ID: item[0] ?? 0,
            SESS_WIDG_INST_ID: item[1] ?? 0,
            REF_OBJECT_ID: item[2] ?? 0,
            REF_OBJECT_TYPE: item[3] ?? 0,
            REF_OBJECT_SUBTYP: item[4] ?? 0,
            OBJECT_NAME: item[5] ?? "",
            USER_NAME: item[6] ?? "",
            ATTR_ID: item[7] ?? 0,
            ATTR_VALUE: item[8] ?? "",
          }));

        const writersReadersInfo: WritersReadersInfo[] =
          writersReadersInfoRaw.map((item: any) => ({
            SESSION_ID: item[0] ?? 0,
            SESS_WIDG_INST_ID: item[1] ?? 0,
            OBJECT_TYPE: item[2] ?? 0,
            OBJECT_SUBTYPE: item[3] ?? 0,
            OBJECT_NAME: item[4] ?? "",
          }));

        console.log(
          sessionConnectionInfo,
          sessionWidgetInfo,
          writersReadersInfo
        );

        const fileReadersWriters = writersReadersInfo.filter((mapping) =>
          mapping.OBJECT_NAME.startsWith("File")
        );

        let tptOperator = "";
        let dbName = "";
        fileReadersWriters.forEach((mapping) => {
          sessionConnectionInfo.forEach((connection) => {
            if (
              mapping.SESS_WIDG_INST_ID === connection.SESS_WIDG_INST_ID &&
              connection.OBJECT_NAME === ""
            ) {
              console.table(mapping);
              console.table(connection);
              tptOperator =
                mapping.OBJECT_NAME === "File Reader"
                  ? "TPTLoadOperator"
                  : "TPTExportOperator";
            }
          });
        });
        interface SwidgetAttrInfo {
          SESS_WIDG_INST_ID: number;
          ATTR_ID: number;
          ATTR_VALUE: string;
        }

        const swidgetAttrInfoRaw = await getSessionWidgetAttrs(task.toTaskId);
        const swidgetAttrInfo: SwidgetAttrInfo[] = swidgetAttrInfoRaw.map(
          (item: [number, number, string]) => ({
            SESS_WIDG_INST_ID: item[0],
            ATTR_ID: item[1],
            ATTR_VALUE: item[2],
          })
        );
        const sourceWidgetInst = sessionWidgetInfo.filter(
          (widget) => widget.WIDGET_TYPE_NAME === "Source Definition"
        );
        const targetWidgetInst = sessionWidgetInfo.filter(
          (widget) => widget.WIDGET_TYPE_NAME === "Target Definition"
        );
        const sqWidgetInst = sessionWidgetInfo.filter(
          (widget) => widget.WIDGET_TYPE_NAME === "Source Qualifier"
        );

        if (tptOperator !== "") {
          const sourceField = await getWidgetSourceFields(
            sourceWidgetInst[0].WIDGET_ID
          );
          const targetField = await getWidgetTargetFields(
            targetWidgetInst[0].WIDGET_ID
          );
          // TODO: INTERFACE
          const fileValues = await getSessionFileVals(
            task.toTaskId,
            tptOperator === "TPTLoadOperator"
              ? sourceWidgetInst[0].SESS_WIDG_INST_ID
              : targetWidgetInst[0].SESS_WIDG_INST_ID
          );

          builder.addImport(
            `from banglalink.airflow.operators.teradata import ${tptOperator}`
          );
          if (tptOperator === "TPTLoadOperator") {
            const connectionInfo = sessionConnectionInfo.filter(
              (info) =>
                info.SESS_WIDG_INST_ID === targetWidgetInst[0].SESS_WIDG_INST_ID
            );
            const dbName =
              connectionInfo[0].ATTR_VALUE === "Teradata"
                ? connectionInfo[1].ATTR_VALUE
                : connectionInfo[0].ATTR_VALUE;
            const schemaVariableName =
              task.toInstName.toUpperCase() + "_SCHEMA_DEFINITION";
            const variableValue = `{${sourceField.map(
              (field: [string, string]) =>
                `"${field[0]}": "VARCHAR(${field[1]})"`
            )}}`;
            const insertStatementArgName =
              task.toInstName.toUpperCase() + "_INSERT_STMT";
            const insertStatementArgValue = `"INSERT INTO {db_name}.{table_name} (${targetField
              .map((field: [string, string]) => `${field[0]}`)
              .join(", ")}) VALUES (${targetField
              .map((field: [string, string]) => `:${field[0]}`)
              .join(", ")});"`;
            const selectStatementArgName =
              task.fromInstName.toUpperCase() + "_SELECT_STMT";

            const selectStatementArgValue = `"SELECT ${sourceField
              .map((field: [string, string]) => `${field[0]}`)
              .join(", ")}"`;

            builder.addVarialbe(schemaVariableName, variableValue);
            builder.addVarialbe(
              insertStatementArgName,
              insertStatementArgValue
            );
            builder.addVarialbe(
              selectStatementArgName,
              selectStatementArgValue
            );

            builder.addTask(
              task.toInstName.toLocaleLowerCase(),
              task.toInstTaskTypeName.toLocaleLowerCase(),
              "",
              "",
              "",
              "",
              "",
              "",
              tptOperator,
              {
                file_dir: `"${fileValues[0][1]}"`,
                file_pattern: `""`,
                file_path: `"${fileValues[0][0]}"`,
                db_name: `"${dbName}"`,
                table_name: `"${targetWidgetInst[0].INSTANCE_NAME}"`,
                schema_name: `"${targetWidgetInst[0].INSTANCE_NAME}_SCHEMA"`,
                schema_definition: schemaVariableName,
                insert_stmt: insertStatementArgName,
                select_stmt: selectStatementArgName,
              }
            );
          } else {
            const sourceSQL = swidgetAttrInfo
              .filter(
                (attr) =>
                  attr.SESS_WIDG_INST_ID === sqWidgetInst[0].SESS_WIDG_INST_ID
              )
              ?.reduce(
                (preSql, newSql) =>
                  preSql + "\n" + `${newSql.ATTR_VALUE ?? ""}`,
                ""
              );

            const sqlVariableName = `${task.toInstName.toUpperCase()}_SQL`;
            builder.addVarialbe(sqlVariableName, `"""${sourceSQL};\n"""`);

            builder.addTask(
              task.toInstName.toLocaleLowerCase(),
              task.toInstTaskTypeName.toLocaleLowerCase(),
              "",
              "",
              "",
              "",
              "",
              "",
              tptOperator,
              {
                job_name: `"${workflowName.toLocaleLowerCase()}"`,
                directory_path: `"${fileValues[0][1]}"`,
                output_file: `"${fileValues[0][0]}"`,
                sql: sqlVariableName,
                delimiter: `","`,
                header: `"None"`,
              }
            );
          }
        } else {
          const sourceSQL = swidgetAttrInfo
            .filter(
              (attr) =>
                attr.SESS_WIDG_INST_ID === sqWidgetInst[0].SESS_WIDG_INST_ID
            )
            ?.reduce(
              (preSql, newSql) => preSql + "\n" + `${newSql.ATTR_VALUE ?? ""}`,
              ""
            );
          const targetSQL = swidgetAttrInfo
            .filter(
              (attr) =>
                attr.SESS_WIDG_INST_ID === targetWidgetInst[0].SESS_WIDG_INST_ID
            )
            ?.reduce(
              (preSql, newSql) => preSql + "\n" + `${newSql.ATTR_VALUE ?? ""}`,
              ""
            );
          const bteqVariableName = task.toInstName.toUpperCase() + "_BTEQ";
          const bteqVariableValue = `"""${
            sourceSQL !== ""
              ? sourceSQL + ";\n.IF ERRORCODE <> 0 THEN .QUIT 0301;\n.QUIT 0;"
              : ""
          }\n\n${
            targetSQL !== "\n"
              ? targetSQL + ";\n.IF ERRORCODE <> 0 THEN .QUIT 0301;\n.QUIT 0;"
              : ""
          }\n"""`;

          builder.addVarialbe(bteqVariableName, bteqVariableValue);

          builder.addImport(
            "from airflow.providers.teradata.operators.bteq import BteqOperator"
          );
          builder.addTask(
            task.toInstName.toLocaleLowerCase(),
            task.toInstTaskTypeName.toLocaleLowerCase(),
            "",
            "",
            "",
            "",
            "",
            "",
            "BteqOperator",
            {
              ttu_conn_id: `"teradata_ifx_db_ttu_up_etl01_conn"`,
              bteq: bteqVariableName,
            }
          );
        }
        builder.addDependency(
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
  }

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

const getSessionConnectionInfo = async (session_id: number): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(SESSION_CONNECTION, {
      SESSION_ID: session_id,
    });

    console.log(session_id, result);
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

const getWritersReadersInfo = async (session_id: number): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(SESSION_WRITERS_READERS, {
      SESSION_ID: session_id,
    });

    console.log(session_id, result);
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

const getSessionWidgetInfo = async (session_id: number): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(SESSION_WIDGET, {
      SESSION_ID: session_id,
    });

    console.log(session_id, result);
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

const getSessionWidgetAttrs = async (session_id: number): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(SESSION_WIDGET_ATTRIBUTES, {
      SESSION_ID: session_id,
    });

    console.log(session_id, result);
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

const getWidgetSourceFields = async (srcId: number): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(WIDGET_SOURCE_FILED, {
      SRC_ID: srcId,
    });

    console.log(srcId, result);
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

const getWidgetTargetFields = async (targetId: number): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(WIDGET_TARGET_FILED, {
      TARGET_ID: targetId,
    });

    console.log(targetId, result);
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

const getSessionFileVals = async (
  session_id: number,
  widget_id: number
): Promise<any> => {
  let { username, password, connectionString } = newConnection;
  const creds = new ConnectionCreds(username, password, connectionString);
  const dbConnection = new Connection(SupportedDatabase.Oracle, creds);
  let connection;
  try {
    connection = await dbConnection.getConnection();

    const result = await connection.execute<any>(SESSION_FILE_VALS, {
      SESSION_ID: session_id,
      WIDGET_ID: widget_id,
    });

    console.log(session_id, result);
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
