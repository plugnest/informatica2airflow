import oracledb from 'oracledb';

export enum SupportedDatabase {
    Oracle = "oracle"
}

export class ConnectionCreds {
    username: string;
    password: string;
    connection_url: string;

    constructor(username: string, password: string, connection_url: string) {
        this.username = username;
        this.password = password;
        this.connection_url = connection_url;
    }
}

export class Connection {
    private dbType: SupportedDatabase;
    private creds: ConnectionCreds;

    constructor(dbType: SupportedDatabase, creds: ConnectionCreds) {
        this.dbType = dbType;
        this.creds = creds;
    }

    async getConnection() {
        if (this.dbType !== SupportedDatabase.Oracle) {
            throw new Error("Unsupported database type");
        }

        let connection;
        try {
            connection = await oracledb.getConnection({
                user: this.creds.username,
                password: this.creds.password,
                connectionString: this.creds.connection_url
            });
            console.log("Successfully connected to Oracle Database");
            return connection;
        } catch (err) {
            console.error("Error connecting to Oracle Database:", err);
            throw err;
        }
    }

    async closeConnection(connection: any) {
        if (connection) {
            try {
                await connection.close();
                console.log("Connection closed successfully");
            } catch (err) {
                console.error("Error closing connection:", err);
            }
        }
    }
}
