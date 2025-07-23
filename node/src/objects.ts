import { asFilePath, asHash, FilePath, Hash } from "./types";
import * as path from "path";
import * as fs from "fs";
export interface ObjectStore {
    has(hash: Hash): Promise<boolean>;
    get(hash: Hash): Promise<Uint8Array>;
    put(hash: Hash, compressed: Uint8Array): Promise<void>;
    iterate(since: Date): AsyncGenerator<{ hash: Hash; content: Uint8Array }>;
}
export class FileBasedObjectStore implements ObjectStore {
    /*
    git-style object store
    */
    constructor(public path: FilePath){// path to "object" folder inside .git folder
    }
    private pathOf(hash:Hash):FilePath{
        // returns path to object file
        // e.g. path.join(this.path, hash.slice(0,2), hash.slice(2,40))
        return asFilePath(path.join(this.path, hash.slice(0, 2), hash.slice(2)));
    }
    async has(hash: Hash): Promise<boolean> {
        // returns true if object file exists
        return fs.existsSync(this.pathOf(hash));
    }
    async get(hash: Hash):Promise<Uint8Array>{
        // returns raw(compressed) Uint8Array of object file(no need to decompress/decode content)
        const filePath = this.pathOf(hash);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Object ${hash} not found at ${filePath}`);
        }
        return fs.readFileSync(filePath);
    }
    async put(hash: Hash, compressed:Uint8Array){
        // saves raw(compressed) Uint8Array to object file
        const filePath = this.pathOf(hash);
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(filePath, compressed);
    }
    async *iterate(since: Date): AsyncGenerator<{hash:Hash, content:Uint8Array}>{
        // iterate newer or equals than since

        for (const head2 of fs.readdirSync(this.path)) {
            //head2 is first 2-chars of hash
            const dir = path.join(this.path, head2);
            if (!fs.statSync(dir).isDirectory()) continue; // skip if not a directory
            const files = fs.readdirSync(dir);
            for (const rest38 of files) {
                const filePath = path.join(dir, rest38);
                const stat = fs.statSync(filePath);
                if (stat.mtime >= since) {
                    const hash = head2 + rest38; // assuming file name is the hash
                    yield { hash: asHash(hash), content: fs.readFileSync(filePath) };
                }
            }
        }
    }

}