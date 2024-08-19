import { GoogleGenerativeAI } from "@google/generative-ai";

export interface Task {
  taskId: string;
  taskType: string;
  functionBody?: string;
  command?: string;
  sensorFileLocation?: string;
  condition?: string;
  taskIfTrue?: string;
  taskIfFalse?: string;
  operator?: string;
  operatorParams?: any;
}

export class DAGBuilder {
  private dagId: string | null = null;
  private defaultArgs: { [key: string]: any } | null = null;
  private imports: Set<string> = new Set();
  private params: { [key: string]: any } | null = null;
  private tasks: Task[] = [];
  private taskIds: string[] = [];
  private tags: string[] = [];
  private callbacks: { onSuccess: string | null; onFailure: string | null } = {
    onSuccess: null,
    onFailure: null,
  };
  private maxActiveRuns: number | null = null;
  private catchup: string | null = null;
  private dependencies: [string, string][] = [];

  constructor() {
    this.addImport("import pendulum");
    this.addImport("from airflow.decorators import dag, task");
    this.addImport("from airflow.sensors.filesystem import FileSensor");
  }

  setDagId(dagId: string): this {
    this.dagId = dagId;
    return this;
  }

  setDefaultArgs(defaultArgs: { [key: string]: any }): this {
    this.defaultArgs = defaultArgs;
    return this;
  }

  setParams(params: { [key: string]: any }): this {
    this.params = params;
    return this;
  }

  addTag(tag: string): this {
    this.tags.push(tag);
    return this;
  }

  setCallbacks(onSuccess: string, onFailure: string): this {
    this.callbacks = { onSuccess, onFailure };
    return this;
  }

  setMaxActiveRuns(maxActiveRuns: number): this {
    this.maxActiveRuns = maxActiveRuns;
    return this;
  }

  setCatchup(catchup: string): this {
    this.catchup = catchup;
    return this;
  }

  addImport(importStatement: string): this {
    this.imports.add(importStatement);
    return this;
  }

  addTask(
    taskId: string,
    taskType: string,
    functionBody?: string,
    command?: string,
    sensorFileLocation?: string,
    condition?: string,
    taskIfTrue?: string,
    taskIfFalse?: string,
    operator?: string,
    operatorParams?: any
  ): this {
    const task: Task = {
      taskId,
      taskType,
      functionBody,
      command,
      sensorFileLocation,
      condition,
      taskIfTrue,
      taskIfFalse,
      operator,
      operatorParams,
    };
    this.tasks.push(task);
    this.taskIds.push(taskId);
    return this;
  }

  addDependency(upstreamTaskId: string, downstreamTaskId: string): this {
    this.dependencies.push([upstreamTaskId, downstreamTaskId]);
    return this;
  }

  build(): string {
    if (!this.dagId || !this.defaultArgs || !this.params) {
      throw new Error("Missing required fields: dagId, defaultArgs, or params");
    }

    let dagCode = "";

    this.imports.forEach((importStatement) => {
      dagCode += `${importStatement}\n`;
    });

    dagCode += `\n\ndefault_args = ${JSON.stringify(this.defaultArgs)}\n\n`;
    dagCode += `@dag(\n`;
    dagCode += `    default_args=default_args,\n`;
    dagCode += `    schedule=None,\n`;
    dagCode += `    start_date=pendulum.today('Asia/Dhaka').add(days=0),\n`;
    dagCode += `    tags=[${this.tags.map((tag) => `'${tag}'`).join(", ")}],\n`;
    dagCode += `    on_failure_callback=${this.callbacks.onFailure},\n`;
    dagCode += `    on_success_callback=${this.callbacks.onSuccess},\n`;
    dagCode += `    params={\n`;
    dagCode += `        "date_value": pendulum.today('Asia/Dhaka').add(days=0).strftime('%Y-%m-%d')\n`;
    dagCode += `    },\n`;
    dagCode += `    max_active_runs=${this.maxActiveRuns},\n`;
    dagCode += `    catchup=${this.catchup}\n`;
    dagCode += `)\n`;

    dagCode += `def ${this.dagId}():\n`;

    this.tasks.forEach((task) => {
      task.taskId = task.taskId.toLocaleLowerCase();
      if (task.taskType === "start") {
        dagCode += `    @task\n`;
        dagCode += `    def ${task.taskId}():\n`;
        dagCode += `        ${task.functionBody}\n`;
        dagCode += `    task_${task.taskId} = ${task.taskId}()\n`;
        dagCode += `    \n\n`;
      } else if (task.taskType === "command") {
        dagCode += `    @task.bash\n`;
        dagCode += `    def ${task.taskId}():\n`;
        dagCode += `        return """${task.command}"""\n`;
        dagCode += `    task_${task.taskId} = ${task.taskId}()\n`;
        dagCode += `    \n\n`;
      } else if (task.taskType === "event wait") {
        dagCode += `    task_${task.taskId} = FileSensor(\n`;
        dagCode += `        task_id='${task.taskId}',\n`;
        dagCode += `        filepath='${task.sensorFileLocation}',\n`;
        dagCode += `        poke_interval=60,\n`;
        dagCode += `        timeout=7200,\n`;
        dagCode += `        mode='poke',\n`;
        dagCode += `        soft_fail=False\n`;
        dagCode += `    )\n\n`;
      } else if (task.taskType === "decision") {
        dagCode += `    @task.branch()\n`;
        dagCode += `    def ${task.taskId}(condition, task_if_true, task_if_false) -> str:\n`;
        dagCode += `        if condition:\n`;
        dagCode += `            return task_if_true\n`;
        dagCode += `        else:\n`;
        dagCode += `            return task_if_false\n`;
        dagCode += `    task_${task.taskId} = ${task.taskId}(condition='${task.condition}', task_if_true='${task.taskIfTrue}', task_if_false='${task.taskIfFalse}')\n`;
        dagCode += `    \n\n`;
      } else if (task.operator) {
        dagCode += `    task_${task.taskId} = ${task.operator}(\n`;
        dagCode += `        task_id='${task.taskId}',\n`;

        if (
          task.operatorParams &&
          Object.keys(task.operatorParams).length > 0
        ) {
          Object.keys(task.operatorParams).forEach((param) => {
            dagCode += `        ${param}='${task.operatorParams[param]}',\n`;
          });
        }
        dagCode += `    )\n`;
        dagCode += `    \n\n`;
      }
    });

    this.dependencies.forEach(([upstreamTaskId, downstreamTaskId]) => {
      dagCode += `    task_${upstreamTaskId.toLocaleLowerCase()} >> task_${downstreamTaskId.toLocaleLowerCase()}\n`;
    });

    dagCode += `\n${this.dagId}()\n`;

    return dagCode;
  }
}
