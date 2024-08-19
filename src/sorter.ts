export interface TaskNode {
  fromInstId: number;
  toInstId: number;
  conditionId: number;
  condition: string | null;
  fromTaskId: number;
  fromInstName: string;
  fromInstTaskType: number;
  fromInstTaskTypeName: string;
  toTaskId: number;
  toInstName: string;
  toInstTaskType: number;
  toInstTaskTypeName: string;
}

export function topoSort(tasks: TaskNode[]): TaskNode[] | string {
  const adjList: Map<number, TaskNode[]> = new Map();
  const inDegree: Map<number, number> = new Map();

  tasks.forEach((task) => {
    if (!adjList.has(task.fromInstId)) {
      adjList.set(task.fromInstId, []);
    }
    adjList.get(task.fromInstId)!.push(task);

    inDegree.set(task.toInstId, (inDegree.get(task.toInstId) || 0) + 1);
    if (!inDegree.has(task.fromInstId)) {
      inDegree.set(task.fromInstId, 0);
    }
  });

  const queue: number[] = [];

  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      const taskNode = tasks.find((t) => t.fromInstId === nodeId);
      if (taskNode) {
        queue.push(taskNode.fromInstId);
      }
    }
  });

  const sortedTasks: TaskNode[] = [];

  while (queue.length > 0) {
    const currentTask = queue.shift()!;

    const neighbors = adjList.get(currentTask) || [];

    adjList.get(currentTask)?.forEach((task) => sortedTasks.push(task));

    neighbors.forEach((neighbor) => {
      inDegree.set(
        neighbor.toInstId,
        (inDegree.get(neighbor.toInstId) || 0) - 1
      );
      if (inDegree.get(neighbor.toInstId) === 0) {
        queue.push(neighbor.toInstId);
      }
    });
  }

  if (sortedTasks.length === tasks.length) {
    return sortedTasks;
  } else {
    return "Cycle detected, topological sorting not possible.";
  }
}
