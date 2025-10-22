import * as path from "path";
import { asFilePath, FilePath } from "./types.js";

export function join(p:FilePath, ...rest:string[]):FilePath {
    return asFilePath(path.join(p,...rest));
}
export function normalize(p:FilePath):FilePath {
    return asFilePath(path.normalize(p));
}
export function dirname(p:FilePath):FilePath{
    return asFilePath(path.dirname(p));
}