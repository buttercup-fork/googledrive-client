export interface GoogleDriveClientOptions {
    /**
     * Milliseconds to wait for an upload or download, 0 for no limit.
     * Default 10 minutes.
     */
    contentTimeout?: number;
    /**
     * Milliseconds to wait for any other request, 0 for no limit. Default 60
     * seconds.
     */
    timeout?: number;
}

export interface Headers {
    [key: string]: string;
}
