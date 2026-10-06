export interface FileItem {
    created: string;
    id: string;
    filename: string;
    modified: string;
    parents: Array<string>;
    mime: string;
    shared: boolean;
    size: number;
    type: "file" | "directory";
}

export interface FileTreeNode {
    id: string | null;
    filename: string | null;
    files: Array<FileItem>;
    children: Array<FileTreeNode>;
}

export function formulateTree(files: FileItem[]): FileTreeNode {
    // 1st pass: Collect all IDs
    const ids = new Set(files.map(file => file.id));
    // 2nd pass: Collect root IDs
    const rootIDs = new Set<string>();
    files.forEach(file => {
        file.parents.forEach(parentID => {
            if (!ids.has(parentID)) {
                // ID is not available in the results, so assume it's root
                rootIDs.add(parentID);
            }
        });
    });
    // 3rd pass: Group items by parent, keeping the order of the results
    const rootItems: Array<FileItem> = [];
    const itemsByParent = new Map<string, Array<FileItem>>();
    files.forEach(file => {
        if (file.parents.length === 0 || file.parents.some(parentID => rootIDs.has(parentID))) {
            rootItems.push(file);
        }
        new Set(file.parents).forEach(parentID => {
            const siblings = itemsByParent.get(parentID);
            if (siblings) {
                siblings.push(file);
            } else {
                itemsByParent.set(parentID, [file]);
            }
        });
    });
    // Level creation
    const getLevel = (item: FileItem | null, items: Array<FileItem>): FileTreeNode => ({
        id: item ? item.id : null,
        filename: item ? item.filename : null,
        files: items.filter(file => file.type === "file"),
        children: items
            .filter(file => file.type === "directory")
            .map(child => getLevel(child, itemsByParent.get(child.id) || []))
    });
    return getLevel(null, rootItems);
}
