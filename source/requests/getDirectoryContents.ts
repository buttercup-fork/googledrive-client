import { HotPatcher } from "hot-patcher";
import { handleBadResponse, RequestConfig } from "../request.js";
import { MIME_FOLDER } from "../symbols.js";
import { FileItem, FileTreeNode, formulateTree } from "../util/directoryContents.js";

interface GoogleDriveObject {
    createdTime: string;
    id: string;
    mimeType: string;
    modifiedTime: string;
    name: string;
    parents?: Array<string>;
    shared: boolean;
    size?: string;
    trashed?: boolean;
    [key: string]: unknown;
}

export interface InternalGetDirectoryContentsOptions {
    currentFiles?: Array<FileItem>;
    formTree: boolean;
    nextPageToken?: string;
    patcher: HotPatcher;
    token: string;
}

export interface PosixPathFileItem extends FileItem {
    dirPath: string;
}

const CACHED_DIR_RESULTS_KEY = "@@dirresults";
const CACHED_DIR_RESULTS_MAX_AGE = 10000;

export async function getDirectoryContents(
    options: InternalGetDirectoryContentsOptions
): Promise<FileTreeNode | FileItem[]> {
    const { currentFiles = [], formTree, nextPageToken = null, patcher, token } = options;
    const config: RequestConfig = {
        url: "https://www.googleapis.com/drive/v3/files",
        method: "GET",
        query: {
            corpora: "allDrives",
            includeItemsFromAllDrives: "true",
            pageSize: "1000",
            spaces: "drive",
            supportsAllDrives: "true",
            fields: "files(id,name,mimeType,createdTime,modifiedTime,shared,size,parents,trashed),nextPageToken"
        },
        headers: {
            Authorization: `Bearer ${token}`
        }
    };
    if (nextPageToken) {
        config.query.pageToken = nextPageToken;
    }
    const response = await patcher.execute<Promise<Response>>("request", config);
    handleBadResponse(response);
    const result = (await response.json()) as {
        files: Array<GoogleDriveObject>;
        nextPageToken?: string;
    };
    const files: Array<FileItem> = [
        ...currentFiles,
        ...result.files
            .filter((file: GoogleDriveObject) => !file.trashed)
            .map((googleFile: GoogleDriveObject) => ({
                id: googleFile.id,
                filename: googleFile.name,
                parents: [...(googleFile.parents || [])],
                mime: googleFile.mimeType,
                type:
                    googleFile.mimeType === MIME_FOLDER
                        ? ("directory" as "directory")
                        : ("file" as "file"),
                created: googleFile.createdTime,
                modified: googleFile.modifiedTime,
                shared: googleFile.shared,
                size: googleFile.size ? parseInt(googleFile.size, 10) : 0
            }))
    ];
    if (result.nextPageToken) {
        return getDirectoryContents({
            currentFiles: files,
            nextPageToken: result.nextPageToken,
            formTree: formTree,
            patcher,
            token
        });
    }
    return formTree ? formulateTree(files) : files;
}

export async function mapDirectoryContents(
    token: string,
    patcher: HotPatcher,
    context: Record<string, any>,
    path: string
): Promise<Array<PosixPathFileItem>> {
    let contents: Array<FileItem>;
    if (
        !context[CACHED_DIR_RESULTS_KEY] ||
        Date.now() - context[CACHED_DIR_RESULTS_KEY].updated > CACHED_DIR_RESULTS_MAX_AGE
    ) {
        contents = (await getDirectoryContents({
            formTree: false,
            patcher,
            token
        })) as Array<FileItem>;
        if (context[CACHED_DIR_RESULTS_KEY]) {
            Object.assign(context[CACHED_DIR_RESULTS_KEY], {
                cachedContents: contents,
                updated: Date.now()
            });
        } else {
            Object.defineProperty(context, CACHED_DIR_RESULTS_KEY, {
                enumerable: false,
                writable: false,
                configurable: false,
                value: {
                    cachedContents: contents,
                    updated: Date.now()
                }
            });
        }
    } else {
        contents = context[CACHED_DIR_RESULTS_KEY].cachedContents;
    }
    const itemsByID = new Map<string, FileItem>();
    contents.forEach(item => {
        if (!itemsByID.has(item.id)) {
            itemsByID.set(item.id, item);
        }
    });
    // Folder names from the top down to the item's (first) parent, cached per folder
    const dirNames = new Map<string, Array<string>>();
    const getDirNames = (itemID: string): Array<string> => {
        const [parentID] = itemsByID.get(itemID).parents;
        const parentItem = itemsByID.get(parentID);
        if (!parentItem) {
            return [];
        }
        let names = dirNames.get(parentID);
        if (!names) {
            names = [...getDirNames(parentID), parentItem.filename];
            dirNames.set(parentID, names);
        }
        return names;
    };
    const pathsMatch = (pathA: string, pathB: string): boolean =>
        pathA.replace(/\/+$/, "") === pathB.replace(/\/+$/, "");
    return contents
        .map(item => ({
            ...item,
            dirPath: `/${getDirNames(item.id).join("/")}`
        }))
        .filter(item => pathsMatch(item.dirPath, path));
}
