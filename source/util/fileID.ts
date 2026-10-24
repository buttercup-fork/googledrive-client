import { Layerr } from "layerr";

export const ERR_INVALID_FILE_ID = "ERR_INVALID_FILE_ID";

/**
 * Encode a file ID for use as a URL path segment. An empty ID and the dot
 * segments "." and ".." are refused: a URL parser resolves those (also when
 * percent-encoded) and the request would go to another path with the token.
 * @param id The file ID
 * @returns The encoded path segment
 */
export function fileIDPathSegment(id: string): string {
    if (typeof id !== "string" || id.length === 0 || id === "." || id === "..") {
        throw new Layerr({ info: { code: ERR_INVALID_FILE_ID } }, "Invalid file ID");
    }
    return encodeURIComponent(id);
}
