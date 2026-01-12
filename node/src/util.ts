import { asPHPTimestamp, PHPTimestamp } from "./types.js";

export function toBase64(content: Uint8Array<ArrayBufferLike>): string {
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