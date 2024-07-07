import * as vscode from 'vscode';

export class SubjectAreaProvider implements vscode.TreeDataProvider<SubjectArea> {
    private _onDidChangeTreeData: vscode.EventEmitter<SubjectArea | undefined | void> = new vscode.EventEmitter<SubjectArea | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SubjectArea | undefined | void> = this._onDidChangeTreeData.event;

    public subjectAreas: SubjectArea[];

    constructor(subjectAreas: SubjectArea[]) {
        this.subjectAreas = subjectAreas;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SubjectArea): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SubjectArea): Thenable<SubjectArea[]> {
        if (element) {
            return Promise.resolve(element.children);
        } else {
            return Promise.resolve(this.subjectAreas);
        }
    }
}

export class SubjectArea extends vscode.TreeItem {
    children: SubjectArea[];

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        children?: SubjectArea[]
    ) {
        super(label, collapsibleState);
        this.children = children || [];
    }
}
