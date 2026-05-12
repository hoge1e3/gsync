import * as path from "path";
import { asFilePath, asPHPTimestamp, FilePath, PHPTimestamp } from "./types.js";
import {promises as fs} from "fs";
export function toBase64(content: Uint8Array<ArrayBufferLike>): string {
    const ca=content as any;
    if (typeof ca.toBase64==="function") return ca.toBase64();
    if (typeof btoa !== "undefined") {
        let binary = "";
        for (let i = 0; i < content.length; i++) {
            binary += String.fromCharCode(content[i]);
        }
        return btoa(binary);
    } else {
        // Node.js environment without Buffer (fallback)
        throw new Error("Base64 encoding not supported in this environment without Buffer.");
    }
}
export function phpTimestampToDate(phpts:PHPTimestamp):Date {
    return new Date(phpts * 1000);
}
export function dateToPhpTimestamp(d:Date):PHPTimestamp {
    return asPHPTimestamp(Math.floor(d.getTime() / 1000));
}
export function join(f:FilePath, ...s:string[]) {
    return asFilePath(path.join(f,...s));
}
export function dirname(f:FilePath):FilePath {
    return asFilePath(path.dirname(f));
}
export async function exists(f:FilePath):Promise<boolean> {
    try {
        await fs.access(f);
        return true;
    } catch (e) {
        return false;
    }
}