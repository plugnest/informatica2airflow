import * as vscode from 'vscode';

export class ConnectionView {
    constructor(public readonly username: string, public readonly password: string, public readonly connectionString: string) { }
}

export class ConnectionsProvider implements vscode.TreeDataProvider<ConnectionNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConnectionNode | undefined> = new vscode.EventEmitter<ConnectionNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ConnectionNode | undefined> = this._onDidChangeTreeData.event;

    private connections: ConnectionNode[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.loadConnections();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ConnectionNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConnectionNode): Thenable<ConnectionNode[]> {
        if (!element) {
            return Promise.resolve(this.connections);
        }
        return Promise.resolve([]);
    }

    addConnection(connection: ConnectionView): void {
        const connectionNode = new ConnectionNode(
            `${connection.username}@${connection.connectionString}`,
            vscode.TreeItemCollapsibleState.None,
            connection,
            this.context
        );
        this.connections.push(connectionNode);
        this.saveConnections();
        this.refresh();
    }
    private loadConnections(): void {
        const storedConnections = this.context.globalState.get<string>('connections');
        if (storedConnections) {
            const parsedConnections: ConnectionView[] = JSON.parse(storedConnections);
            this.connections = parsedConnections.map(connection => new ConnectionNode(
                `${connection.username}@${connection.connectionString}`,
                vscode.TreeItemCollapsibleState.None,
                connection,
                this.context
            ));
        }
    }
    private saveConnections(): void {
        const connectionViews = this.connections.map(node => node.connection);
        this.context.globalState.update('connections', JSON.stringify(connectionViews));
    }
}

export class ConnectionNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly connection: ConnectionView,
        public readonly context: vscode.ExtensionContext
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}`;
        this.iconPath = {
            light: this.context.asAbsolutePath('resources/light/radio-tower.svg'),
            dark: this.context.asAbsolutePath('resources/dark/radio-tower.svg'),
        };
        this.contextValue = 'connectionNode';
        // this.command = {
        //     command: 'informatica2airflow.openConnection',
        //     title: 'Get Subject Areas for this Connection',
        //     arguments: [this.connection]
        // };
    }
}
